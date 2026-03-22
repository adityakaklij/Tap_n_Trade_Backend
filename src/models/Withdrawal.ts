import mongoose, { type InferSchemaType } from 'mongoose'

export type WithdrawalStatus = 'requested' | 'submitted' | 'confirmed' | 'failed'

const WithdrawalSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, index: true },
    amountMist: { type: mongoose.Schema.Types.Decimal128, required: true },
    status: { type: String, required: true, enum: ['requested', 'submitted', 'confirmed', 'failed'] satisfies WithdrawalStatus[] },

    // Merkle leaf fields (required for deterministic proofs)
    nonce: { type: mongoose.Schema.Types.Decimal128, required: true },
    balanceBeforeMist: { type: mongoose.Schema.Types.Decimal128, required: true },
    balanceAfterMist: { type: mongoose.Schema.Types.Decimal128, required: true },

    // Phase 1 fields
    suiTxHash: { type: String },
    failureReason: { type: String },
    confirmedAt: { type: Date },

    // Phase 2 reserved (Merkle / Sui proof based withdrawals)
    checkpointId: { type: String },
    merkleProof: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
)

WithdrawalSchema.index({ walletAddress: 1, createdAt: -1 })
WithdrawalSchema.index({ status: 1, createdAt: -1 })
WithdrawalSchema.index({ suiTxHash: 1 }, { sparse: true })

export type WithdrawalDoc = InferSchemaType<typeof WithdrawalSchema> & { _id: mongoose.Types.ObjectId }

export const WithdrawalModel = mongoose.model('Withdrawal', WithdrawalSchema)

