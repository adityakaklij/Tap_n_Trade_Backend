import mongoose, { type InferSchemaType } from 'mongoose'

export type RoundStatus = 'open' | 'closed' | 'settling' | 'settled'

const RoundSchema = new mongoose.Schema(
  {
    tokenPairId: { type: mongoose.Schema.Types.ObjectId, ref: 'TokenPair', required: true, index: true },
    roundNumber: { type: Number, required: true },
    openTime: { type: Date, required: true, index: true },
    closeTime: { type: Date, required: true },
    openPrice: { type: mongoose.Schema.Types.Decimal128, required: true },
    closePrice: { type: mongoose.Schema.Types.Decimal128 },
    settlementPrice: { type: mongoose.Schema.Types.Decimal128 },
    sigma: { type: Number },
    rawGrid: { type: mongoose.Schema.Types.Decimal128 },
    livePrice: { type: mongoose.Schema.Types.Decimal128 },
    gridSize: { type: mongoose.Schema.Types.Decimal128, required: true },
    top: { type: mongoose.Schema.Types.Decimal128, required: true },
    bottom: { type: mongoose.Schema.Types.Decimal128, required: true },
    cells: {
      type: [
        {
          cellIndex: { type: Number, required: true },
          zoneLow: { type: mongoose.Schema.Types.Decimal128, required: true },
          zoneHigh: { type: mongoose.Schema.Types.Decimal128, required: true },
          probability: { type: Number, required: true },
          baseMultiplier: { type: Number, required: true },
          adjustedMultiplier: { type: Number, required: true },
          totalStakeMist: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' }
        }
      ],
      required: true,
      default: []
    },
    status: { type: String, required: true, enum: ['open', 'closed', 'settling', 'settled'] satisfies RoundStatus[] },
    totalBets: { type: Number, required: true, default: 0 },
    totalStakesMist: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' },
    totalPayoutsMist: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' },
    settledAt: { type: Date }
  },
  { timestamps: true }
)

RoundSchema.index({ tokenPairId: 1, roundNumber: -1 }, { unique: true })
RoundSchema.index({ status: 1, openTime: -1 })

export type RoundDoc = InferSchemaType<typeof RoundSchema> & { _id: mongoose.Types.ObjectId }

export const RoundModel = mongoose.model('Round', RoundSchema)

