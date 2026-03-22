import { blake3 } from '@noble/hashes/blake3.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export function blake3Hex(data: Uint8Array): string {
  return bytesToHex(blake3(data))
}

export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

