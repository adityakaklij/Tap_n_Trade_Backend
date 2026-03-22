import mongoose, { type InferSchemaType } from 'mongoose'

const UserSchema = new mongoose.Schema(
  {
    walletAddress: { type: String, required: true, unique: true, index: true },
    balanceMist: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' },
    lockedBalanceMist: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' },
    nonce: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' },
    stats: {
      type: {
        totalDepositedMist: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' },
        totalWithdrawnMist: { type: mongoose.Schema.Types.Decimal128, required: true, default: '0' },
        totalBets: { type: Number, required: true, default: 0 },
        totalWins: { type: Number, required: true, default: 0 },
        totalLosses: { type: Number, required: true, default: 0 }
      },
      required: true,
      default: () => ({})
    },
    lastSeenAt: { type: Date }
  },
  { timestamps: true }
)

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: mongoose.Types.ObjectId }

export const UserModel = mongoose.model('User', UserSchema)

