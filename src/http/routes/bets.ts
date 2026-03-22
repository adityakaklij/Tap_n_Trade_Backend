import { Router } from 'express'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { BetModel, RoundModel, TokenPairModel, UserModel } from '../../models/index.js'
import { decFromDb, dbDecimal } from '../../lib/money.js'
import { WalletAddressSchema } from '../validators.js'
import { HttpError } from '../errors.js'
import { adjustedMultiplier } from '../../engine/index.js'
import { eventBus } from '../../events.js'
import { asyncHandler } from '../asyncHandler.js'

export const betsRouter = Router()

betsRouter.post('/bets', asyncHandler(async (req, res) => {
  const body = z
    .object({
      walletAddress: WalletAddressSchema,
      tokenPairId: z.string().regex(/^[0-9a-fA-F]{24}$/),
      cellIndex: z.number().int().positive(),
      stakeMist: z.string().regex(/^\d+$/)
    })
    .parse(req.body)

  const tokenPair = await TokenPairModel.findById(body.tokenPairId)
  if (!tokenPair || !tokenPair.isActive) throw new HttpError(404, 'TokenPairNotFound')

  const round = await RoundModel.findOne({ tokenPairId: body.tokenPairId, status: 'open' }).sort({ roundNumber: -1 })
  if (!round) throw new HttpError(404, 'NoOpenRound')
  if (new Date() > round.closeTime) throw new HttpError(400, 'RoundClosing')

  const cell = round.cells.find((c) => c.cellIndex === body.cellIndex)
  if (!cell) throw new HttpError(400, 'InvalidCellIndex')

  const stake = new Decimal(body.stakeMist)
  if (stake.lte(0)) throw new HttpError(400, 'InvalidStake')

  const user = (await UserModel.findOne({ walletAddress: body.walletAddress })) ?? (await UserModel.create({ walletAddress: body.walletAddress }))
  const balance = decFromDb(user.balanceMist)
  if (balance.lessThan(stake)) throw new HttpError(400, 'InsufficientBalance')

  const totalStakeInCell = decFromDb(cell.totalStakeMist).plus(stake)
  const poolCap = decFromDb(tokenPair.poolCapacityMist)
  const maxMult = tokenPair.maxMultiplier ?? 10
  const minMult = tokenPair.minMultiplier ?? 1.2
  const nextAdjusted = Math.max(minMult, Math.min(adjustedMultiplier(cell.baseMultiplier, totalStakeInCell, poolCap, tokenPair.dampeningFactor), maxMult))

  // Persist: update round cell exposure + multiplier
  cell.totalStakeMist = dbDecimal(totalStakeInCell)
  cell.adjustedMultiplier = nextAdjusted
  await round.save()

  // Lock user balance
  const locked = decFromDb(user.lockedBalanceMist)
  user.balanceMist = dbDecimal(balance.minus(stake))
  user.lockedBalanceMist = dbDecimal(locked.plus(stake))
  user.nonce = dbDecimal(decFromDb(user.nonce).plus(1))
  user.stats.totalBets += 1
  await user.save()

  const bet = await BetModel.create({
    walletAddress: body.walletAddress,
    userId: user._id,
    roundId: round._id,
    tokenPairId: tokenPair._id,
    cellIndex: body.cellIndex,
    zoneLow: cell.zoneLow,
    zoneHigh: cell.zoneHigh,
    stakeMist: dbDecimal(stake),
    baseMultiplier: cell.baseMultiplier,
    adjustedMultiplier: nextAdjusted,
    payoutMist: undefined,
    nonce: user.nonce,
    status: 'accepted',
    balanceBeforeMist: dbDecimal(balance),
    balanceAfterMist: dbDecimal(balance.minus(stake)),
    placedAt: new Date()
  })

  eventBus.emitEvent({
    type: 'grid.snapshot',
    tokenPairId: tokenPair._id.toString(),
    symbol: tokenPair.symbol,
    roundId: round._id.toString(),
    roundNumber: round.roundNumber,
    price: decFromDb(round.livePrice ?? round.openPrice).toString(),
    sigma: round.sigma ?? 0,
    rawGrid: round.rawGrid ? decFromDb(round.rawGrid).toString() : '0',
    gridSize: decFromDb(round.gridSize).toString(),
    top: decFromDb(round.top).toString(),
    bottom: decFromDb(round.bottom).toString(),
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

  res.status(201).json({
    betId: bet._id.toString(),
    roundId: round._id.toString(),
    roundNumber: round.roundNumber,
    tokenPairId: tokenPair._id.toString(),
    cellIndex: bet.cellIndex,
    zoneLow: decFromDb(bet.zoneLow).toString(),
    zoneHigh: decFromDb(bet.zoneHigh).toString(),
    stakeMist: stake.toFixed(0),
    adjustedMultiplier: bet.adjustedMultiplier
  })
}))

betsRouter.get('/bets', asyncHandler(async (req, res) => {
  const q = z.object({ walletAddress: WalletAddressSchema, limit: z.coerce.number().int().positive().max(200).default(50) }).parse(req.query)
  const bets = await BetModel.find({ walletAddress: q.walletAddress }).sort({ placedAt: -1 }).limit(q.limit).lean()
  res.json(
    bets.map((b) => ({
      betId: b._id.toString(),
      roundId: b.roundId.toString(),
      tokenPairId: b.tokenPairId.toString(),
      cellIndex: b.cellIndex,
      zoneLow: decFromDb(b.zoneLow).toString(),
      zoneHigh: decFromDb(b.zoneHigh).toString(),
      stakeMist: decFromDb(b.stakeMist).toFixed(0),
      status: b.status,
      adjustedMultiplier: b.adjustedMultiplier,
      payoutMist: b.payoutMist ? decFromDb(b.payoutMist).toFixed(0) : null,
      placedAt: b.placedAt.toISOString(),
      settledAt: b.settledAt ? b.settledAt.toISOString() : null
    }))
  )
}))

