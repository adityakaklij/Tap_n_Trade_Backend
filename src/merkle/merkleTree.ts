import { MERKLE } from '../config/constants.js'
import { canonicalJsonStringify } from './canonicalJson.js'
import { blake3Hex, utf8Bytes } from './hash.js'

export type MerkleLeaf = {
  leafHash: string
  serialized: string
}

export type MerkleProofStep = {
  siblingHash: string
  siblingSide: 'left' | 'right'
}

export type MerkleTreeResult = {
  rootHash: string
  leafHashes: string[] // padded to power-of-2
  originalLeafCount: number
}

export function hashLeafObject(obj: unknown): MerkleLeaf {
  const serialized = canonicalJsonStringify(obj)
  const leafHash = blake3Hex(utf8Bytes(serialized))
  return { leafHash, serialized }
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

export function buildMerkleTreeFromLeafHashes(leafHashesUnpadded: string[]): MerkleTreeResult {
  const originalLeafCount = leafHashesUnpadded.length
  const target = nextPow2(Math.max(1, originalLeafCount))
  const emptyHash = blake3Hex(utf8Bytes(MERKLE.EMPTY_LEAF_SENTINEL))

  const leafHashes: string[] = [...leafHashesUnpadded]
  while (leafHashes.length < target) leafHashes.push(emptyHash)

  let level = leafHashes
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!
      const right = level[i + 1]!
      next.push(blake3Hex(utf8Bytes(left + right)))
    }
    level = next
  }

  return { rootHash: level[0]!, leafHashes, originalLeafCount }
}

export function buildMerkleProof(leafHashesPadded: string[], leafIndex: number): MerkleProofStep[] {
  if (leafIndex < 0 || leafIndex >= leafHashesPadded.length) throw new Error('LeafIndexOutOfRange')
  if ((leafHashesPadded.length & (leafHashesPadded.length - 1)) !== 0) throw new Error('LeavesNotPowerOfTwo')

  const proof: MerkleProofStep[] = []
  let idx = leafIndex
  let level = leafHashesPadded

  while (level.length > 1) {
    const isRight = idx % 2 === 1
    const siblingIndex = isRight ? idx - 1 : idx + 1
    proof.push({
      siblingHash: level[siblingIndex]!,
      siblingSide: isRight ? 'left' : 'right'
    })

    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      next.push(blake3Hex(utf8Bytes(level[i]! + level[i + 1]!)))
    }
    level = next
    idx = Math.floor(idx / 2)
  }

  return proof
}

/**
 * Recompute root from a leaf hash and a Merkle path (sibling hashes + whether sibling was left or right of the running node).
 * Must match `buildMerkleProof` pairing order: parent = blake3(left + right) as concatenated hex strings.
 */
export function verifyMerkleRootFromPath(leafHash: string, proof: MerkleProofStep[]): string {
  let current = leafHash
  for (const step of proof) {
    if (step.siblingSide === 'right') {
      // current is left child
      current = blake3Hex(utf8Bytes(current + step.siblingHash))
    } else {
      // sibling is left, current is right child
      current = blake3Hex(utf8Bytes(step.siblingHash + current))
    }
  }
  return current
}

