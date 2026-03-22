import mongoose, { type InferSchemaType } from 'mongoose'

const PriceTickSchema = new mongoose.Schema(
  {
    tokenPairId: { type: mongoose.Schema.Types.ObjectId, ref: 'TokenPair', required: true, index: true },
    t: { type: Date, required: true, index: true },
    price: { type: mongoose.Schema.Types.Decimal128, required: true }
  },
  { timestamps: true }
)

PriceTickSchema.index({ tokenPairId: 1, t: -1 })

export type PriceTickDoc = InferSchemaType<typeof PriceTickSchema> & { _id: mongoose.Types.ObjectId }

export const PriceTickModel = mongoose.model('PriceTick', PriceTickSchema)

