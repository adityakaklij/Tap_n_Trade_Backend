import { Router } from 'express'
import { z } from 'zod'
import { MerkleCheckpointModel } from '../../models/index.js'
import { asyncHandler } from '../asyncHandler.js'
import { HttpError } from '../errors.js'
import { hashLeafObject, verifyMerkleRootFromPath, type MerkleProofStep } from '../../merkle/merkleTree.js'

export const merkleRouter = Router()

merkleRouter.get('/merkle/checkpoints/latest', asyncHandler(async (_req, res) => {
  const cp = await MerkleCheckpointModel.findOne().sort({ checkpointNumber: -1 }).lean()
  if (!cp) {
    res.status(404).json({ error: 'NoCheckpoints' })
    return
  }
  res.json({
    checkpointId: cp._id.toString(),
    checkpointNumber: cp.checkpointNumber,
    rootHash: cp.rootHash,
    totalRecords: cp.totalRecords,
    fromTimestampSec: cp.fromTimestampSec,
    toTimestampSec: cp.toTimestampSec,
    coveredThroughAt: cp.coveredThroughAt ? new Date(cp.coveredThroughAt).toISOString() : null,
    status: cp.status,
    chainTxHash: cp.chainTxHash ?? null,
    signature: cp.signature ?? null,
    createdAt: cp.createdAt.toISOString(),
    updatedAt: cp.updatedAt.toISOString()
  })
}))

merkleRouter.get('/merkle/checkpoints/latest-confirmed', asyncHandler(async (_req, res) => {
  const cp = await MerkleCheckpointModel.findOne({ status: 'confirmed' }).sort({ checkpointNumber: -1 }).lean()
  if (!cp) {
    res.status(404).json({ error: 'NoConfirmedCheckpoints' })
    return
  }
  res.json({
    checkpointId: cp._id.toString(),
    checkpointNumber: cp.checkpointNumber,
    rootHash: cp.rootHash,
    totalRecords: cp.totalRecords,
    fromTimestampSec: cp.fromTimestampSec,
    toTimestampSec: cp.toTimestampSec,
    coveredThroughAt: cp.coveredThroughAt ? new Date(cp.coveredThroughAt).toISOString() : null,
    status: cp.status,
    chainTxHash: cp.chainTxHash ?? null,
    signature: cp.signature ?? null,
    createdAt: cp.createdAt.toISOString(),
    updatedAt: cp.updatedAt.toISOString()
  })
}))

merkleRouter.post('/merkle/verify', asyncHandler(async (req, res) => {
  const body = z
    .object({
      checkpointNumber: z.coerce.number().int().positive(),
      record: z.record(z.unknown()),
      proof_path: z.array(z.string().min(1)),
      proof_path_sides: z.array(z.enum(['left', 'right']))
    })
    .refine((x) => x.proof_path.length === x.proof_path_sides.length, { message: 'proof_path length must match proof_path_sides' })
    .parse(req.body)

  const cp = await MerkleCheckpointModel.findOne({ checkpointNumber: body.checkpointNumber }).lean()
  if (!cp) throw new HttpError(404, 'CheckpointNotFound')

  const { leafHash } = hashLeafObject(body.record)
  const steps: MerkleProofStep[] = body.proof_path.map((siblingHash, i) => ({
    siblingHash,
    siblingSide: body.proof_path_sides[i]!
  }))

  const computedRoot = verifyMerkleRootFromPath(leafHash, steps)
  const valid = computedRoot === cp.rootHash

  res.json({
    valid,
    checkpointNumber: cp.checkpointNumber,
    expectedRootHash: cp.rootHash,
    computedRootHash: computedRoot,
    leafHash,
    checkpointStatus: cp.status,
    chainTxHash: cp.chainTxHash ?? null
  })
}))
