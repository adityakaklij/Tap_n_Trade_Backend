import Decimal from 'decimal.js'
import { eventBus } from '../events.js'
import { logger } from '../lib/logger.js'
import { decFromDb, dbDecimal, dbDecimalPrice } from '../lib/money.js'
import { BetModel, PriceTickModel, RoundModel, TokenPairModel, UserModel } from '../models/index.js'
import { adjustedMultiplier, buildGrid, cellProbability, computeVolatility, roundCleanGrid, scaleMultipliersByProbability } from '../engine/index.js'

type RunnerState = {
  tokenPairId: string
  symbol: string
  roundDurationSec: number
  gridCellCount: number
  tickIntervalSec: number
  k: number
  houseEdgeH: number
  minMultiplier: number
  maxMultiplier: number
  dampeningFactor: number
  poolCapacityMist: Decimal
  timer?: NodeJS.Timeout
}

export class RoundEngine {
  private readonly runners = new Map<string, RunnerState>()
  private readonly lastGridUpdateAt = new Map<string, number>() // tokenPairId -> ms

  async start() {
    const pairs = await TokenPairModel.find({ isActive: true }).lean()
    for (const p of pairs) {
      this.ensureRunner({
        tokenPairId: p._id.toString(),
        symbol: p.symbol,
        roundDurationSec: p.roundDurationSec,
        gridCellCount: p.gridCellCount,
        tickIntervalSec: p.tickIntervalSec,
        k: p.k,
        houseEdgeH: p.houseEdgeH,
        minMultiplier: p.minMultiplier ?? 1.2,
        maxMultiplier: p.maxMultiplier ?? 10,
        dampeningFactor: p.dampeningFactor,
        poolCapacityMist: decFromDb(p.poolCapacityMist)
      })
    }

    // Drive continuous in-round grid updates off price ticks
    eventBus.on('price.tick', (evt) => {
      const r = this.runners.get(evt.tokenPairId)
      if (!r) return
      void this.updateOpenRoundGrid(r)
    })
  }

  async refreshFromDb() {
    const pairs = await TokenPairModel.find({ isActive: true }).lean()
    const activeIds = new Set(pairs.map((p) => p._id.toString()))
    for (const p of pairs) {
      this.ensureRunner({
        tokenPairId: p._id.toString(),
        symbol: p.symbol,
        roundDurationSec: p.roundDurationSec,
        gridCellCount: p.gridCellCount,
        tickIntervalSec: p.tickIntervalSec,
        k: p.k,
        houseEdgeH: p.houseEdgeH,
        minMultiplier: p.minMultiplier ?? 1.2,
        maxMultiplier: p.maxMultiplier ?? 10,
        dampeningFactor: p.dampeningFactor,
        poolCapacityMist: decFromDb(p.poolCapacityMist)
      })
    }
    for (const [id, r] of this.runners.entries()) {
      if (!activeIds.has(id)) {
        if (r.timer) clearTimeout(r.timer)
        this.runners.delete(id)
      }
    }
  }

  private ensureRunner(next: RunnerState) {
    const existing = this.runners.get(next.tokenPairId)
    if (existing) return
    this.runners.set(next.tokenPairId, next)
    this.scheduleNextRound(next, new Date())
  }

  private scheduleNextRound(r: RunnerState, now: Date) {
    const ms = r.roundDurationSec * 1000
    const nextBoundary = Math.floor(now.getTime() / ms) * ms + ms
    const delay = Math.max(50, nextBoundary - now.getTime())
    r.timer = setTimeout(() => void this.openRound(r), delay)
    r.timer.unref()
  }

  private async getLatestPrices(r: RunnerState, count: number) {
    const ticks = await PriceTickModel.find({ tokenPairId: r.tokenPairId }).sort({ t: -1 }).limit(count).lean()
    return ticks
      .map((t) => decFromDb(t.price))
      .reverse()
      .filter((d) => d.greaterThan(0))
  }

  private async openRound(r: RunnerState) {
    const openTime = new Date()
    const closeTime = new Date(openTime.getTime() + r.roundDurationSec * 1000)

    const prices = await this.getLatestPrices(r, 61)
    if (prices.length < 2) {
      logger.warn({ symbol: r.symbol }, 'Not enough price history to open round')
      this.scheduleNextRound(r, openTime)
      return
    }
    const P = prices[prices.length - 1]!
    const vol = computeVolatility(prices, 60)
    const sigma = vol.sigma

    const rawGrid = P.times(sigma).times(r.k)
    const gridSize = roundCleanGrid(rawGrid)
    const grid = buildGrid(P, gridSize, r.gridCellCount)

    const probInputs = { P, sigma, T: 1 }
    const probs = grid.cells.map((c) => cellProbability(c.zoneLow, c.zoneHigh, probInputs))
    const bases = scaleMultipliersByProbability(probs, r.minMultiplier, r.maxMultiplier)
    const cells = grid.cells.map((c, idx) => {
      const prob = probs[idx] ?? 0
      const base = bases[idx] ?? r.minMultiplier
      const totalStake = new Decimal(0)
      const adj = Math.max(r.minMultiplier, Math.min(adjustedMultiplier(base, totalStake, r.poolCapacityMist, r.dampeningFactor), r.maxMultiplier))
      return {
        cellIndex: c.cellIndex,
        zoneLow: dbDecimalPrice(c.zoneLow),
        zoneHigh: dbDecimalPrice(c.zoneHigh),
        probability: prob,
        baseMultiplier: base,
        adjustedMultiplier: adj,
        totalStakeMist: dbDecimal(totalStake)
      }
    })

    const lastRound = await RoundModel.findOne({ tokenPairId: r.tokenPairId }).sort({ roundNumber: -1 }).lean()
    const roundNumber = (lastRound?.roundNumber ?? 0) + 1

    const round = await RoundModel.create({
      tokenPairId: r.tokenPairId,
      roundNumber,
      openTime,
      closeTime,
      openPrice: dbDecimalPrice(P),
      livePrice: dbDecimalPrice(P),
      sigma,
      rawGrid: dbDecimalPrice(rawGrid),
      gridSize: dbDecimalPrice(gridSize),
      top: dbDecimalPrice(grid.top),
      bottom: dbDecimalPrice(grid.bottom),
      cells,
      status: 'open'
    })

    eventBus.emitEvent({
      type: 'round.open',
      tokenPairId: r.tokenPairId,
      symbol: r.symbol,
      roundId: round._id.toString(),
      roundNumber,
      openTime: openTime.toISOString(),
      closeTime: closeTime.toISOString()
    })

    eventBus.emitEvent({
      type: 'grid.snapshot',
      tokenPairId: r.tokenPairId,
      symbol: r.symbol,
      roundId: round._id.toString(),
      roundNumber,
      price: P.toString(),
      sigma,
      rawGrid: rawGrid.toString(),
      gridSize: gridSize.toString(),
      top: grid.top.toString(),
      bottom: grid.bottom.toString(),
      cells: round.cells.map((x) => ({
        cellIndex: x.cellIndex,
        zoneLow: decFromDb(x.zoneLow).toString(),
        zoneHigh: decFromDb(x.zoneHigh).toString(),
        probability: x.probability,
        baseMultiplier: x.baseMultiplier,
        adjustedMultiplier: x.adjustedMultiplier,
        totalStakeMist: decFromDb(x.totalStakeMist).toFixed(0)
      }))
    })

    const msUntilClose = Math.max(50, closeTime.getTime() - Date.now())
    setTimeout(() => void this.closeAndSettleRound(r, round._id.toString(), closeTime), msUntilClose).unref()
    this.scheduleNextRound(r, openTime)
  }

  private async updateOpenRoundGrid(r: RunnerState) {
    // throttle to at most once per second per pair (even if tick rate changes)
    const now = Date.now()
    const last = this.lastGridUpdateAt.get(r.tokenPairId) ?? 0
    if (now - last < 1000) return
    this.lastGridUpdateAt.set(r.tokenPairId, now)

    const round = await RoundModel.findOne({ tokenPairId: r.tokenPairId, status: 'open' }).sort({ roundNumber: -1 })
    if (!round) return

    const prices = await this.getLatestPrices(r, 61)
    if (prices.length < 2) return
    const P = prices[prices.length - 1]!
    const vol = computeVolatility(prices, 60)
    const sigma = vol.sigma

    const rawGrid = P.times(sigma).times(r.k)
    const gridSize = roundCleanGrid(rawGrid)
    const grid = buildGrid(P, gridSize, r.gridCellCount)
    const probInputs = { P, sigma, T: 1 }

    const probs = grid.cells.map((c) => cellProbability(c.zoneLow, c.zoneHigh, probInputs))
    const bases = scaleMultipliersByProbability(probs, r.minMultiplier, r.maxMultiplier)

    // Preserve exposure by cellIndex; recompute zones/prob/base and adjusted with exposure.
    for (const c of round.cells) {
      const cellIdx = c.cellIndex
      const newCell = grid.cells.find((x) => x.cellIndex === cellIdx)
      if (!newCell) continue
      const prob = probs[cellIdx - 1] ?? cellProbability(newCell.zoneLow, newCell.zoneHigh, probInputs)
      const base = bases[cellIdx - 1] ?? r.minMultiplier
      const exposure = decFromDb(c.totalStakeMist)
      const adj = Math.max(r.minMultiplier, Math.min(adjustedMultiplier(base, exposure, r.poolCapacityMist, r.dampeningFactor), r.maxMultiplier))

      c.zoneLow = dbDecimalPrice(newCell.zoneLow)
      c.zoneHigh = dbDecimalPrice(newCell.zoneHigh)
      c.probability = prob
      c.baseMultiplier = base
      c.adjustedMultiplier = adj
    }

    round.livePrice = dbDecimalPrice(P)
    round.sigma = sigma
    round.rawGrid = dbDecimalPrice(rawGrid)
    round.gridSize = dbDecimalPrice(gridSize)
    round.top = dbDecimalPrice(grid.top)
    round.bottom = dbDecimalPrice(grid.bottom)
    await round.save()

    eventBus.emitEvent({
      type: 'grid.snapshot',
      tokenPairId: r.tokenPairId,
      symbol: r.symbol,
      roundId: round._id.toString(),
      roundNumber: round.roundNumber,
      price: P.toString(),
      sigma,
      rawGrid: rawGrid.toString(),
      gridSize: gridSize.toString(),
      top: grid.top.toString(),
      bottom: grid.bottom.toString(),
      cells: round.cells.map((x) => ({
        cellIndex: x.cellIndex,
        zoneLow: decFromDb(x.zoneLow).toString(),
        zoneHigh: decFromDb(x.zoneHigh).toString(),
        probability: x.probability,
        baseMultiplier: x.baseMultiplier,
        adjustedMultiplier: x.adjustedMultiplier,
        totalStakeMist: decFromDb(x.totalStakeMist).toFixed(0)
      }))
    })
  }

  private async closeAndSettleRound(r: RunnerState, roundId: string, closeTime: Date) {
    await RoundModel.updateOne({ _id: roundId, status: 'open' }, { $set: { status: 'closed' } })
    const roundForEvent = await RoundModel.findById(roundId).lean()
    const roundNumber = roundForEvent?.roundNumber ?? -1
    eventBus.emitEvent({ type: 'round.close', tokenPairId: r.tokenPairId, symbol: r.symbol, roundId, roundNumber, closeTime: closeTime.toISOString() })

    await RoundModel.updateOne({ _id: roundId }, { $set: { status: 'settling' } })

    const settlementTick =
      (await PriceTickModel.findOne({ tokenPairId: r.tokenPairId, t: { $gte: closeTime } }).sort({ t: 1 }).lean()) ??
      (await PriceTickModel.findOne({ tokenPairId: r.tokenPairId }).sort({ t: -1 }).lean())

    if (!settlementTick) {
      logger.warn({ symbol: r.symbol, roundId }, 'No settlement tick available; refunding round')
      await this.refundRound(roundId)
      await RoundModel.updateOne({ _id: roundId }, { $set: { status: 'settled', settledAt: new Date() } })
      return
    }

    const settlementPrice = decFromDb(settlementTick.price)
    await RoundModel.updateOne(
      { _id: roundId },
      { $set: { status: 'settled', settlementPrice: dbDecimalPrice(settlementPrice), closePrice: dbDecimalPrice(settlementPrice), settledAt: new Date() } }
    )

    const bets = await BetModel.find({ roundId, status: 'accepted' }).lean()
    for (const b of bets) {
      const zoneLow = decFromDb(b.zoneLow)
      const zoneHigh = decFromDb(b.zoneHigh)
      const win = settlementPrice.greaterThanOrEqualTo(zoneLow) && settlementPrice.lessThan(zoneHigh)

      const stake = decFromDb(b.stakeMist)
      const payout = win ? stake.times(b.adjustedMultiplier) : new Decimal(0)

      const user = await UserModel.findOne({ walletAddress: b.walletAddress })
      if (!user) {
        await BetModel.updateOne(
          { _id: b._id },
          { $set: { status: win ? 'won' : 'lost', payoutMist: dbDecimal(payout), settledAt: new Date() } }
        )
        continue
      }
      const balance = decFromDb(user.balanceMist)
      const locked = decFromDb(user.lockedBalanceMist)

      const nextLocked = Decimal.max(0, locked.minus(stake))
      const nextBalance = balance.plus(payout)
      user.lockedBalanceMist = dbDecimal(nextLocked)
      user.balanceMist = dbDecimal(nextBalance)
      if (win) user.stats.totalWins += 1
      else user.stats.totalLosses += 1
      await user.save()

      await BetModel.updateOne(
        { _id: b._id },
        { $set: { status: win ? 'won' : 'lost', payoutMist: dbDecimal(payout), balanceAfterMist: dbDecimal(nextBalance), settledAt: new Date() } }
      )
    }

    eventBus.emitEvent({
      type: 'round.settled',
      tokenPairId: r.tokenPairId,
      symbol: r.symbol,
      roundId,
      roundNumber,
      settlementPrice: settlementPrice.toString(),
      settledAt: new Date().toISOString()
    })
  }

  private async refundRound(roundId: string) {
    const bets = await BetModel.find({ roundId, status: 'accepted' }).lean()
    for (const b of bets) {
      const stake = decFromDb(b.stakeMist)
      const user = await UserModel.findOne({ walletAddress: b.walletAddress })
      if (!user) continue
      const balance = decFromDb(user.balanceMist)
      const locked = decFromDb(user.lockedBalanceMist)
      const nextLocked = Decimal.max(0, locked.minus(stake))
      const nextBalance = balance.plus(stake)
      user.lockedBalanceMist = dbDecimal(nextLocked)
      user.balanceMist = dbDecimal(nextBalance)
      await user.save()

      await BetModel.updateOne({ _id: b._id }, { $set: { status: 'refunded', payoutMist: dbDecimal(stake), balanceAfterMist: dbDecimal(nextBalance), settledAt: new Date() } })
    }
  }
}

