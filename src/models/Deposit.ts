import mongoose, { type InferSchemaType } from 'mongoose'

export type DepositStatus = 'pending' | 'confirmed' | 'credited'

const DepositSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, index: true },
    amountMist: { type: mongoose.Schema.Types.Decimal128, required: true },
    status: { type: String, required: true, enum: ['pending', 'confirmed', 'credited'] satisfies DepositStatus[] },
    suiTxHash: { type: String }, // optional in phase1

    // Merkle leaf fields (required for deterministic proofs)
    nonce: { type: mongoose.Schema.Types.Decimal128, required: true },
    balanceBeforeMist: { type: mongoose.Schema.Types.Decimal128, required: true },
    balanceAfterMist: { type: mongoose.Schema.Types.Decimal128, required: true }
  },
  { timestamps: true }
)

DepositSchema.index({ suiTxHash: 1 }, { unique: true, sparse: true })
DepositSchema.index({ walletAddress: 1, createdAt: -1 })

export type DepositDoc = InferSchemaType<typeof DepositSchema> & { _id: mongoose.Types.ObjectId }

export const DepositModel = mongoose.model('Deposit', DepositSchema)

