import mongoose, { type InferSchemaType } from 'mongoose'

const TokenPairSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, unique: true, index: true }, // e.g. BTCUSDT
    tickIntervalSec: { type: Number, required: true, default: 5 },
    roundDurationSec: { type: Number, required: true, default: 10 },
    gridCellCount: { type: Number, required: true, default: 10 },
    k: { type: Number, required: true, default: 0.5 },
    houseEdgeH: { type: Number, required: true, default: 0.04 },
    minMultiplier: { type: Number, required: true, default: 1.2 },
    maxMultiplier: { type: Number, required: true, default: 10 },
    dampeningFactor: { type: Number, required: true, default: 0.3 },
    poolCapacityMist: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' },
    isActive: { type: Boolean, required: true, default: true }
  },
  { timestamps: true }
)

export type TokenPairDoc = InferSchemaType<typeof TokenPairSchema> & { _id: mongoose.Types.ObjectId }

export const TokenPairModel = mongoose.model('TokenPair', TokenPairSchema)

