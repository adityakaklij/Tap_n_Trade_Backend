import mongoose, { type InferSchemaType } from 'mongoose'

export type BetStatus = 'accepted' | 'won' | 'lost' | 'refunded'

const BetSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Round', required: true, index: true },
    tokenPairId: { type: mongoose.Schema.Types.ObjectId, ref: 'TokenPair', required: true, index: true },
    cellIndex: { type: Number, required: true }, // 1..N (k in calculations)
    zoneLow: { type: mongoose.Schema.Types.Decimal128, required: true },
    zoneHigh: { type: mongoose.Schema.Types.Decimal128, required: true },
    stakeMist: { type: mongoose.Schema.Types.Decimal128, required: true },
    baseMultiplier: { type: Number, required: true },
    adjustedMultiplier: { type: Number, required: true },
    payoutMist: { type: mongoose.Schema.Types.Decimal128 },
    nonce: { type: mongoose.Schema.Types.Decimal128, required: true },
    status: { type: String, required: true, enum: ['accepted', 'won', 'lost', 'refunded'] satisfies BetStatus[] },
    balanceBeforeMist: { type: mongoose.Schema.Types.Decimal128, required: true },
    balanceAfterMist: { type: mongoose.Schema.Types.Decimal128 },
    placedAt: { type: Date, required: true, default: () => new Date() },
    settledAt: { type: Date }
  },
  { timestamps: true }
)

BetSchema.index({ walletAddress: 1, placedAt: -1 })
BetSchema.index({ roundId: 1, status: 1 })

export type BetDoc = InferSchemaType<typeof BetSchema> & { _id: mongoose.Types.ObjectId }

export const BetModel = mongoose.model('Bet', BetSchema)

