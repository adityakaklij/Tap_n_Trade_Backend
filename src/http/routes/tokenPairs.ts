import { Router } from 'express'
import { z } from 'zod'
import { TokenPairModel } from '../../models/index.js'
import { decFromDb } from '../../lib/money.js'
import { ObjectIdSchema } from '../validators.js'
import { asyncHandler } from '../asyncHandler.js'

export const tokenPairsRouter = Router()

tokenPairsRouter.get('/token-pairs', asyncHandler(async (_req, res) => {
  const pairs = await TokenPairModel.find({}).sort({ createdAt: -1 }).lean()
  res.json(
    pairs.map((p) => ({
      tokenPairId: p._id.toString(),
      symbol: p.symbol,
      tickIntervalSec: p.tickIntervalSec,
      roundDurationSec: p.roundDurationSec,
      gridCellCount: p.gridCellCount,
      k: p.k,
      houseEdgeH: p.houseEdgeH,
      minMultiplier: p.minMultiplier,
      maxMultiplier: p.maxMultiplier,
      dampeningFactor: p.dampeningFactor,
      poolCapacityMist: decFromDb(p.poolCapacityMist).toFixed(0),
      isActive: p.isActive
    }))
  )
}))

tokenPairsRouter.post('/token-pairs', asyncHandler(async (req, res) => {
  const body = z
    .object({
      symbol: z.string().min(3).max(30),
      tickIntervalSec: z.number().int().positive().default(5),
      roundDurationSec: z.number().int().positive().default(10),
      gridCellCount: z.number().int().positive().default(10),
      k: z.number().positive().default(0.5),
      houseEdgeH: z.number().min(0).max(0.2).default(0.04),
      minMultiplier: z.number().min(1).max(10).default(1.2),
      maxMultiplier: z.number().min(1).max(100).default(10),
      dampeningFactor: z.number().min(0).max(1).default(0.3),
      poolCapacityMist: z.string().regex(/^\d+$/).default('0'),
      isActive: z.boolean().default(true)
    })
    .parse(req.body)

  const doc = await TokenPairModel.create(body)
  res.status(201).json({ tokenPairId: doc._id.toString() })
}))

tokenPairsRouter.patch('/token-pairs/:tokenPairId', asyncHandler(async (req, res) => {
  const tokenPairId = ObjectIdSchema.parse(req.params.tokenPairId)
  const body = z
    .object({
      isActive: z.boolean().optional(),
      tickIntervalSec: z.number().int().positive().optional(),
      roundDurationSec: z.number().int().positive().optional(),
      gridCellCount: z.number().int().positive().optional(),
      k: z.number().positive().optional(),
      houseEdgeH: z.number().min(0).max(0.2).optional(),
      minMultiplier: z.number().min(1).max(10).optional(),
      maxMultiplier: z.number().min(1).max(100).optional(),
      dampeningFactor: z.number().min(0).max(1).optional(),
      poolCapacityMist: z.string().regex(/^\d+$/).optional()
    })
    .parse(req.body)

  await TokenPairModel.updateOne({ _id: tokenPairId }, { $set: body })
  res.json({ ok: true })
}))

