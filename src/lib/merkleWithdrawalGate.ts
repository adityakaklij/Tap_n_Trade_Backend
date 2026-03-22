import { MERKLE } from '../config/constants.js'
import { BetModel, DepositModel, MerkleCheckpointModel, WithdrawalModel } from '../models/index.js'
import { HttpError } from '../http/errors.js'

/**
 * Latest time any Merkle-relevant row existed for this wallet (before a new withdrawal is created).
 */
export async function getUserLastMerkleEventAt(walletAddress: string): Promise<Date | null> {
  const [d, b, w] = await Promise.all([
    DepositModel.findOne({ walletAddress }).sort({ createdAt: -1 }).select({ createdAt: 1 }).lean(),
    BetModel.findOne({ walletAddress }).sort({ placedAt: -1 }).select({ placedAt: 1 }).lean(),
    WithdrawalModel.findOne({ walletAddress }).sort({ createdAt: -1 }).select({ createdAt: 1 }).lean()
  ])
  const times = [d?.createdAt?.getTime(), b?.placedAt?.getTime(), w?.createdAt?.getTime()].filter(
    (t): t is number => typeof t === 'number'
  )
  if (times.length === 0) return null
  return new Date(Math.max(...times))
}

function checkpointCoverageDate(cp: { coveredThroughAt?: Date; toTimestampSec: number }): Date {
  if (cp.coveredThroughAt) return new Date(cp.coveredThroughAt)
  return new Date(cp.toTimestampSec * 1000)
}

/**
 * Ensures there is an on-chain-confirmed (DB: status confirmed) checkpoint that includes all
 * prior activity for this wallet. New activity after that snapshot must wait for the next confirmed checkpoint.
 */
export async function assertWithdrawalAllowedByMerkle(walletAddress: string): Promise<void> {
  if (!MERKLE.WITHDRAWAL_REQUIRES_CONFIRMED_CHECKPOINT) return

  const latestConfirmed = await MerkleCheckpointModel.findOne({ status: 'confirmed' }).sort({ checkpointNumber: -1 }).lean()

  if (!latestConfirmed) {
    throw new HttpError(503, 'NoConfirmedMerkleCheckpoint', {
      message: 'Wait until at least one Merkle root is confirmed (on-chain / simulated).'
    })
  }

  const coveredThrough = checkpointCoverageDate(latestConfirmed)
  const lastEvent = await getUserLastMerkleEventAt(walletAddress)

  if (lastEvent && lastEvent.getTime() > coveredThrough.getTime()) {
    throw new HttpError(409, 'MerkleCheckpointPending', {
      message:
        'Your latest activity is not yet included in a confirmed Merkle checkpoint. Wait for the next root confirmation before withdrawing.',
      coveredThroughAt: coveredThrough.toISOString(),
      lastMerkleEventAt: lastEvent.toISOString()
    })
  }
}
