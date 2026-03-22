import { Router } from 'express'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { UserModel } from '../../models/index.js'
import { decFromDb, dbDecimal } from '../../lib/money.js'
import { WalletAddressSchema } from '../validators.js'
import { asyncHandler } from '../asyncHandler.js'

export const usersRouter = Router()

usersRouter.post(
  '/users/upsert',
  asyncHandler(async (req, res) => {
    const body = z.object({ walletAddress: WalletAddressSchema }).parse(req.body)
    const doc =
      (await UserModel.findOne({ walletAddress: body.walletAddress })) ??
      (await UserModel.create({ walletAddress: body.walletAddress }))

    doc.lastSeenAt = new Date()
    await doc.save()
    res.json({
      userId: doc._id.toString(),
      walletAddress: doc.walletAddress,
      balanceMist: decFromDb(doc.balanceMist).toFixed(0),
      lockedBalanceMist: decFromDb(doc.lockedBalanceMist).toFixed(0),
      nonce: decFromDb(doc.nonce).toFixed(0)
    })
  })
)

usersRouter.get('/users/:walletAddress', asyncHandler(async (req, res) => {
  const walletAddress = WalletAddressSchema.parse(req.params.walletAddress)
  const doc = await UserModel.findOne({ walletAddress })
  if (!doc) {
    res.status(404).json({ error: 'UserNotFound' })
    return
  }
  res.json({
    userId: doc._id.toString(),
    walletAddress: doc.walletAddress,
    balanceMist: decFromDb(doc.balanceMist).toFixed(0),
    lockedBalanceMist: decFromDb(doc.lockedBalanceMist).toFixed(0),
    nonce: decFromDb(doc.nonce).toFixed(0),
    stats: {
      totalDepositedMist: decFromDb(doc.stats.totalDepositedMist).toFixed(0),
      totalWithdrawnMist: decFromDb(doc.stats.totalWithdrawnMist).toFixed(0),
      totalBets: doc.stats.totalBets,
      totalWins: doc.stats.totalWins,
      totalLosses: doc.stats.totalLosses
    }
  })
}))

usersRouter.post('/users/:walletAddress/credit', asyncHandler(async (req, res) => {
  const walletAddress = WalletAddressSchema.parse(req.params.walletAddress)
  const body = z.object({ amountMist: z.string().regex(/^\d+$/) }).parse(req.body)
  const amount = new Decimal(body.amountMist)
  const user = (await UserModel.findOne({ walletAddress })) ?? (await UserModel.create({ walletAddress }))

  user.balanceMist = dbDecimal(decFromDb(user.balanceMist).plus(amount))
  user.stats.totalDepositedMist = dbDecimal(decFromDb(user.stats.totalDepositedMist).plus(amount))
  await user.save()
  res.json({ ok: true })
}))

