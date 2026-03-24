import { Router } from 'express'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { DepositModel, UserModel } from '../../models/index.js'
import { decFromDb, dbDecimal } from '../../lib/money.js'
import { resolveAmountMistString } from '../../lib/amountInput.js'
import { WalletAddressSchema } from '../validators.js'
import { asyncHandler } from '../asyncHandler.js'
import { mintDepositHypercertAndLog } from '../../services/hypercert.js'

export const depositsRouter = Router()

depositsRouter.post('/deposits', asyncHandler(async (req, res) => {
  const body = z
    .object({
      walletAddress: WalletAddressSchema,
      /** Integer base units (string or JSON number), e.g. `"1000"` or `1000`. */
      amountMist: z.union([z.string(), z.number()]).optional(),
      /** Human OCT amount, e.g. `"0.1"` → 1000 base units when TOKEN_DECIMALS=4. */
      amountOct: z.string().optional(),
      suiTxHash: z.string().optional()
    })
    .parse(req.body)

  const amountMistStr = resolveAmountMistString({
    ...(body.amountMist !== undefined ? { amountMist: body.amountMist } : {}),
    ...(body.amountOct !== undefined ? { amountOct: body.amountOct } : {})
  })
  const amount = new Decimal(amountMistStr)
  const user = (await UserModel.findOne({ walletAddress: body.walletAddress })) ?? (await UserModel.create({ walletAddress: body.walletAddress }))
  const balanceBefore = decFromDb(user.balanceMist)
  const nextNonce = decFromDb(user.nonce).plus(1)
  const balanceAfter = balanceBefore.plus(amount)

  user.balanceMist = dbDecimal(balanceAfter)
  user.nonce = dbDecimal(nextNonce)
  user.stats.totalDepositedMist = dbDecimal(decFromDb(user.stats.totalDepositedMist).plus(amount))
  await user.save()

  const dep = await DepositModel.create({
    walletAddress: body.walletAddress,
    amountMist: dbDecimal(amountMistStr),
    status: 'credited',
    suiTxHash: body.suiTxHash,
    nonce: dbDecimal(nextNonce),
    balanceBeforeMist: dbDecimal(balanceBefore),
    balanceAfterMist: dbDecimal(balanceAfter)
  })

  const response = {
    depositId: dep._id.toString(),
    status: dep.status,
    amountMist: decFromDb(dep.amountMist).toFixed(0),
    balanceMist: decFromDb(user.balanceMist).toFixed(0),
    nonce: decFromDb(user.nonce).toFixed(0)
  }

  // Non-blocking: deposit success must not depend on Hypercert availability.
  void mintDepositHypercertAndLog({
    depositId: response.depositId,
    walletAddress: body.walletAddress,
    amountMist: response.amountMist,
    balanceMist: response.balanceMist,
    nonce: response.nonce
  })

  res.status(201).json(response)
}))

depositsRouter.get('/deposits', asyncHandler(async (req, res) => {
  const q = z.object({ walletAddress: WalletAddressSchema }).parse(req.query)
  const deps = await DepositModel.find({ walletAddress: q.walletAddress }).sort({ createdAt: -1 }).limit(200).lean()
  res.json(
    deps.map((d) => ({
      depositId: d._id.toString(),
      walletAddress: d.walletAddress,
      amountMist: decFromDb(d.amountMist).toFixed(0),
      status: d.status,
      suiTxHash: d.suiTxHash ?? null,
      createdAt: d.createdAt.toISOString()
    }))
  )
}))

