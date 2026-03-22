import { MERKLE } from '../config/constants.js'
import { BetModel, DepositModel, MerkleCheckpointModel, WithdrawalModel } from '../models/index.js'
import { decFromDb } from '../lib/money.js'
import { logger } from '../lib/logger.js'
import { buildMerkleTreeFromLeafHashes, hashLeafObject } from '../merkle/merkleTree.js'

type LeafRef = {
  type: 'DEPOSIT' | 'BET' | 'WITHDRAWAL'
  recordId: string
  walletAddress: string
  nonce: string
  timestampSec: number
}

function dateToTimestampSec(d: Date): number {
  return Math.floor(d.getTime() / 1000)
}

function decStr(v: unknown): string {
  return decFromDb(v).toFixed(0)
}

export class MerkleCheckpointService {
  private timer: NodeJS.Timeout | null = null
  private lastBuildAtMs = 0

  async start() {
    // Build once on boot (non-blocking for the rest of the system)
    void this.buildCheckpointIfDue().catch((err) => logger.error({ err }, 'Merkle checkpoint build failed'))

    this.timer = setInterval(() => {
      void this.buildCheckpointIfDue().catch((err) => logger.error({ err }, 'Merkle checkpoint build failed'))
    }, MERKLE.CHECKPOINT_INTERVAL_MS)
  }

  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async buildCheckpointIfDue() {
    const now = Date.now()
    if (MERKLE.MIN_BUILD_GAP_MS > 0 && now - this.lastBuildAtMs < MERKLE.MIN_BUILD_GAP_MS) return
    this.lastBuildAtMs = now
    await this.buildCheckpoint()
  }

  async buildCheckpoint() {
    const latest = await MerkleCheckpointModel.findOne().sort({ checkpointNumber: -1 }).lean()
    const checkpointNumber = (latest?.checkpointNumber ?? 0) + 1

    const toTime = new Date()
    const toTimestampSec = dateToTimestampSec(toTime)
    const fromTimestampSec = latest?.toTimestampSec ?? 0

    // Collect all records up to checkpoint time.
    // Per merkelTree.txt v1: rebuild entire tree each checkpoint with ALL records.
    const [deposits, bets, withdrawals] = await Promise.all([
      DepositModel.find({ createdAt: { $lte: toTime } }).sort({ createdAt: 1 }).lean(),
      BetModel.find({ placedAt: { $lte: toTime } }).sort({ placedAt: 1 }).lean(),
      WithdrawalModel.find({ createdAt: { $lte: toTime } }).sort({ createdAt: 1 }).lean()
    ])

    const leaves: { timestampSec: number; ref: LeafRef; leafHash: string }[] = []

    for (const d of deposits) {
      const ts = dateToTimestampSec(d.createdAt)
      const leafObj = {
        type: 'DEPOSIT',
        deposit_id: d._id.toString(),
        wallet_address: d.walletAddress,
        amount: decStr(d.amountMist),
        sui_tx_hash: d.suiTxHash ?? null,
        timestamp: ts,
        nonce: decStr(d.nonce),
        cumulative_balance_after: decStr(d.balanceAfterMist)
      }
      const { leafHash } = hashLeafObject(leafObj)
      leaves.push({
        timestampSec: ts,
        ref: { type: 'DEPOSIT', recordId: d._id.toString(), walletAddress: d.walletAddress, nonce: decStr(d.nonce), timestampSec: ts },
        leafHash
      })
    }

    for (const b of bets) {
      const ts = dateToTimestampSec(b.placedAt)
      const leafObj = {
        type: 'BET',
        bet_id: b._id.toString(),
        wallet_address: b.walletAddress,
        round_id: b.roundId.toString(),
        zone_low: decFromDb(b.zoneLow).toString(),
        zone_high: decFromDb(b.zoneHigh).toString(),
        stake: decStr(b.stakeMist),
        result: b.status === 'accepted' ? null : b.status.toUpperCase(),
        payout: b.payoutMist ? decStr(b.payoutMist) : null,
        multiplier: b.adjustedMultiplier,
        timestamp: ts,
        nonce: decStr(b.nonce),
        cumulative_balance_after: b.balanceAfterMist ? decStr(b.balanceAfterMist) : decStr(b.balanceBeforeMist)
      }
      const { leafHash } = hashLeafObject(leafObj)
      leaves.push({
        timestampSec: ts,
        ref: { type: 'BET', recordId: b._id.toString(), walletAddress: b.walletAddress, nonce: decStr(b.nonce), timestampSec: ts },
        leafHash
      })
    }

    for (const w of withdrawals) {
      const ts = dateToTimestampSec(w.createdAt)
      const leafObj = {
        type: 'WITHDRAWAL',
        withdrawal_id: w._id.toString(),
        wallet_address: w.walletAddress,
        amount: decStr(w.amountMist),
        timestamp: ts,
        nonce: decStr(w.nonce),
        cumulative_balance_after: decStr(w.balanceAfterMist)
      }
      const { leafHash } = hashLeafObject(leafObj)
      leaves.push({
        timestampSec: ts,
        ref: { type: 'WITHDRAWAL', recordId: w._id.toString(), walletAddress: w.walletAddress, nonce: decStr(w.nonce), timestampSec: ts },
        leafHash
      })
    }

    // Sort chronologically (stable tie-breakers for deterministic ordering)
    leaves.sort((a, b) => {
      if (a.timestampSec !== b.timestampSec) return a.timestampSec - b.timestampSec
      if (a.ref.walletAddress !== b.ref.walletAddress) return a.ref.walletAddress.localeCompare(b.ref.walletAddress)
      if (a.ref.type !== b.ref.type) return a.ref.type.localeCompare(b.ref.type)
      return a.ref.recordId.localeCompare(b.ref.recordId)
    })

    const leafHashesUnpadded = leaves.map((x) => x.leafHash)
    const tree = buildMerkleTreeFromLeafHashes(leafHashesUnpadded)

    const leafRefs: LeafRef[] = leaves.map((x) => x.ref)

    const cp = await MerkleCheckpointModel.create({
      checkpointNumber,
      rootHash: tree.rootHash,
      totalRecords: tree.originalLeafCount,
      fromTimestampSec,
      toTimestampSec,
      coveredThroughAt: toTime,
      leafRefs,
      leafHashes: tree.leafHashes,
      status: 'built'
    })

    logger.info(
      {
        checkpointNumber,
        rootHash: tree.rootHash,
        totalRecords: tree.originalLeafCount,
        paddedLeaves: tree.leafHashes.length
      },
      'Merkle checkpoint built'
    )

    // Chain submission: DB-only until Sui worker exists. Optionally simulate confirmation.
    void this.runSubmissionLifecycle(cp._id.toString())

    return cp
  }

  /**
   * Marks checkpoint submitted; if SIMULATE_CHAIN_CONFIRMATION, marks confirmed with a placeholder chainTxHash.
   * Real deployment: set SIMULATE_CHAIN_CONFIRMATION=false and update via a worker when the tx succeeds.
   */
  private async runSubmissionLifecycle(checkpointId: string) {
    await MerkleCheckpointModel.updateOne({ _id: checkpointId }, { $set: { status: 'submitted' } })

    if (!MERKLE.SIMULATE_CHAIN_CONFIRMATION) return

    await new Promise((r) => setTimeout(r, MERKLE.SIMULATED_CHAIN_CONFIRMATION_DELAY_MS))
    const fakeTx =
      MERKLE.SIMULATED_CHAIN_TX_HASH_PREFIX +
      checkpointId.replaceAll(/[^0-9a-f]/gi, '').slice(0, 24).padEnd(24, '0')
    await MerkleCheckpointModel.updateOne(
      { _id: checkpointId },
      { $set: { status: 'confirmed', chainTxHash: fakeTx } }
    )
    logger.info({ checkpointId, chainTxHash: fakeTx }, 'Merkle checkpoint simulated on-chain confirmation')
  }

  async getLatestCheckpoint() {
    return MerkleCheckpointModel.findOne().sort({ checkpointNumber: -1 }).lean()
  }

  async findCheckpointContainingLeaf(type: LeafRef['type'], recordId: string) {
    return MerkleCheckpointModel.findOne({ 'leafRefs.type': type, 'leafRefs.recordId': recordId }).sort({ checkpointNumber: -1 }).lean()
  }
}

