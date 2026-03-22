import { Router } from 'express'
import { z } from 'zod'
import { RoundModel } from '../../models/index.js'
import { decFromDb } from '../../lib/money.js'
import { ObjectIdSchema } from '../validators.js'
import { asyncHandler } from '../asyncHandler.js'

export const roundsRouter = Router()

roundsRouter.get('/rounds/current', asyncHandler(async (req, res) => {
  const q = z.object({ tokenPairId: ObjectIdSchema }).parse(req.query)
  const round = await RoundModel.findOne({ tokenPairId: q.tokenPairId, status: { $in: ['open', 'closed', 'settling'] } }).sort({ roundNumber: -1 }).lean()
  if (!round) {
    res.status(404).json({ error: 'NoActiveRound' })
    return
  }
  res.json({
    roundId: round._id.toString(),
    tokenPairId: round.tokenPairId.toString(),
    roundNumber: round.roundNumber,
    status: round.status,
    openTime: round.openTime.toISOString(),
    closeTime: round.closeTime.toISOString(),
    openPrice: decFromDb(round.openPrice).toString(),
    price: round.livePrice ? decFromDb(round.livePrice).toString() : decFromDb(round.openPrice).toString(),
    sigma: round.sigma ?? null,
    rawGrid: round.rawGrid ? decFromDb(round.rawGrid).toString() : null,
    settlementPrice: round.settlementPrice ? decFromDb(round.settlementPrice).toString() : null,
    gridSize: decFromDb(round.gridSize).toString(),
    top: decFromDb(round.top).toString(),
    bottom: decFromDb(round.bottom).toString(),
    cells: round.cells.map((c) => ({
      cellIndex: c.cellIndex,
      zoneLow: decFromDb(c.zoneLow).toString(),
      zoneHigh: decFromDb(c.zoneHigh).toString(),
      probability: c.probability,
      baseMultiplier: c.baseMultiplier,
      adjustedMultiplier: c.adjustedMultiplier,
      totalStakeMist: decFromDb(c.totalStakeMist).toFixed(0)
    }))
  })
}))

roundsRouter.get('/rounds/recent', asyncHandler(async (req, res) => {
  const q = z.object({ tokenPairId: ObjectIdSchema, limit: z.coerce.number().int().positive().max(200).default(20) }).parse(req.query)
  const rounds = await RoundModel.find({ tokenPairId: q.tokenPairId }).sort({ roundNumber: -1 }).limit(q.limit).lean()
  res.json(
    rounds.map((r) => ({
      roundId: r._id.toString(),
      roundNumber: r.roundNumber,
      status: r.status,
      openTime: r.openTime.toISOString(),
      closeTime: r.closeTime.toISOString(),
      settlementPrice: r.settlementPrice ? decFromDb(r.settlementPrice).toString() : null,
      totalBets: r.totalBets,
      totalStakesMist: decFromDb(r.totalStakesMist).toFixed(0),
      totalPayoutsMist: decFromDb(r.totalPayoutsMist).toFixed(0)
    }))
  )
}))

