import mongoose, { type InferSchemaType } from 'mongoose'

export type MerkleLeafRefType = 'DEPOSIT' | 'BET' | 'WITHDRAWAL'

const LeafRefSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: ['DEPOSIT', 'BET', 'WITHDRAWAL'] satisfies MerkleLeafRefType[] },
    recordId: { type: String, required: true },
    walletAddress: { type: String, required: true, index: true },
    nonce: { type: String, required: true }, // store as string to avoid Decimal128 quirks in nested docs
    timestampSec: { type: Number, required: true }
  },
  { _id: false }
)

const MerkleCheckpointSchema = new mongoose.Schema(
  {
    checkpointNumber: { type: Number, required: true, unique: true, index: true },
    rootHash: { type: String, required: true, index: true },
    totalRecords: { type: Number, required: true },
    fromTimestampSec: { type: Number, required: true },
    toTimestampSec: { type: Number, required: true, index: true },

    /** Wall-clock upper bound used when querying leaves (same instant as `toTimestampSec`, full precision). */
    coveredThroughAt: { type: Date, required: true, index: true },

    // Persist leaf data so proofs can be generated without rebuilding from scratch.
    // (Aligned arrays: leafRefs[i] corresponds to leafHashes[i].)
    leafRefs: { type: [LeafRefSchema], required: true },
    leafHashes: { type: [String], required: true },

    // Future: signature + chain submission tx hash
    signature: { type: String },
    chainTxHash: { type: String },
    status: { type: String, required: true, enum: ['built', 'submitted', 'confirmed', 'failed'] as const, default: 'built' },
    error: { type: String }
  },
  { timestamps: true }
)

MerkleCheckpointSchema.index({ toTimestampSec: -1 })

export type MerkleCheckpointDoc = InferSchemaType<typeof MerkleCheckpointSchema> & { _id: mongoose.Types.ObjectId }

export const MerkleCheckpointModel = mongoose.model('MerkleCheckpoint', MerkleCheckpointSchema)

