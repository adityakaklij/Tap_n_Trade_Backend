import { Router } from 'express'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { WithdrawalModel, UserModel } from '../../models/index.js'
import { decFromDb, dbDecimal } from '../../lib/money.js'
import { resolveAmountMistString } from '../../lib/amountInput.js'
import { WalletAddressSchema } from '../validators.js'
import { HttpError } from '../errors.js'
import { asyncHandler } from '../asyncHandler.js'
import { MerkleCheckpointModel } from '../../models/index.js'
import { buildMerkleProof } from '../../merkle/merkleTree.js'
import { assertWithdrawalAllowedByMerkle } from '../../lib/merkleWithdrawalGate.js'

export const withdrawalsRouter = Router()

withdrawalsRouter.post('/withdrawals', asyncHandler(async (req, res) => {
  const body = z
    .object({
      walletAddress: WalletAddressSchema,
      amountMist: z.union([z.string(), z.number()]).optional(),
      amountOct: z.string().optional()
    })
    .parse(req.body)

  const user = await UserModel.findOne({ walletAddress: body.walletAddress })
  if (!user) throw new HttpError(404, 'UserNotFound')

  await assertWithdrawalAllowedByMerkle(body.walletAddress)

  const amountMistStr = resolveAmountMistString({
    ...(body.amountMist !== undefined ? { amountMist: body.amountMist } : {}),
    ...(body.amountOct !== undefined ? { amountOct: body.amountOct } : {})
  })
  const amount = new Decimal(amountMistStr)
  const balanceBefore = decFromDb(user.balanceMist)
  if (balanceBefore.lessThan(amount)) throw new HttpError(400, 'InsufficientBalance')
  const nextNonce = decFromDb(user.nonce).plus(1)
  const balanceAfter = balanceBefore.minus(amount)

  user.balanceMist = dbDecimal(balanceAfter)
  user.nonce = dbDecimal(nextNonce)
  user.stats.totalWithdrawnMist = dbDecimal(decFromDb(user.stats.totalWithdrawnMist).plus(amount))
  await user.save()

  const wd = await WithdrawalModel.create({
    walletAddress: body.walletAddress,
    amountMist: dbDecimal(amountMistStr),
    status: 'requested',
    nonce: dbDecimal(nextNonce),
    balanceBeforeMist: dbDecimal(balanceBefore),
    balanceAfterMist: dbDecimal(balanceAfter)
  })

  res.status(201).json({
    withdrawalId: wd._id.toString(),
    status: wd.status,
    amountMist: decFromDb(wd.amountMist).toFixed(0),
    balanceMist: decFromDb(user.balanceMist).toFixed(0),
    nonce: decFromDb(user.nonce).toFixed(0)
  })
}))

withdrawalsRouter.get('/withdrawals', asyncHandler(async (req, res) => {
  const q = z.object({ walletAddress: WalletAddressSchema }).parse(req.query)
  const wds = await WithdrawalModel.find({ walletAddress: q.walletAddress }).sort({ createdAt: -1 }).limit(200).lean()
  res.json(
    wds.map((w) => ({
      withdrawalId: w._id.toString(),
      walletAddress: w.walletAddress,
      amountMist: decFromDb(w.amountMist).toFixed(0),
      status: w.status,
      suiTxHash: w.suiTxHash ?? null,
      failureReason: w.failureReason ?? null,
      createdAt: w.createdAt.toISOString(),
      confirmedAt: w.confirmedAt ? w.confirmedAt.toISOString() : null
    }))
  )
}))

withdrawalsRouter.get('/withdrawals/:withdrawalId/merkle-proof', asyncHandler(async (req, res) => {
  const withdrawalId = z.string().regex(/^[0-9a-fA-F]{24}$/).parse(req.params.withdrawalId)
  const wd = await WithdrawalModel.findById(withdrawalId).lean()
  if (!wd) throw new HttpError(404, 'WithdrawalNotFound')

  const cp = await MerkleCheckpointModel.findOne({
    status: 'confirmed',
    'leafRefs.type': 'WITHDRAWAL',
    'leafRefs.recordId': withdrawalId
  })
    .sort({ checkpointNumber: -1 })
    .lean()
  if (!cp) throw new HttpError(404, 'CheckpointNotFoundForWithdrawalOrNotConfirmed')

  const leafIndex = cp.leafRefs.findIndex((x) => x.type === 'WITHDRAWAL' && x.recordId === withdrawalId)
  if (leafIndex < 0) throw new HttpError(500, 'LeafIndexNotFound')

  const steps = buildMerkleProof(cp.leafHashes, leafIndex)

  const proofPayload = {
    checkpointNumber: cp.checkpointNumber,
    rootHash: cp.rootHash,
    record: {
      type: 'WITHDRAWAL',
      withdrawal_id: wd._id.toString(),
      wallet_address: wd.walletAddress,
      amount: decFromDb(wd.amountMist).toFixed(0),
      timestamp: Math.floor(wd.createdAt.getTime() / 1000),
      nonce: decFromDb(wd.nonce).toFixed(0),
      cumulative_balance_after: decFromDb(wd.balanceAfterMist).toFixed(0)
    },
    proof_path: steps.map((s) => s.siblingHash),
    proof_path_sides: steps.map((s) => s.siblingSide),
    backend_signature: cp.signature ?? null,
    chainTxHash: cp.chainTxHash ?? null,
    checkpointStatus: cp.status
  }

  // Store it for phase-2 workflows (optional)
  await WithdrawalModel.updateOne(
    { _id: wd._id },
    { $set: { checkpointId: cp._id.toString(), merkleProof: proofPayload } }
  )

  res.json(proofPayload)
}))

