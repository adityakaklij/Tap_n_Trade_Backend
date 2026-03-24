import { AtpAgent } from '@atproto/api'
import { logger } from '../lib/logger.js'

const BSKY_SERVICE = 'https://bsky.social'
const COLLECTION = 'org.hypercerts.claim.activity'

function isHypercertEnabled(): boolean {
  return process.env.HYPERCERT_ENABLED === 'true'
}

function hyperscanUrlFromAtUri(atUri: string): string {
  const m = String(atUri).match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (!m) return `https://www.hyperscan.dev/data?uri=${encodeURIComponent(atUri)}`
  const did = m[1] ?? ''
  const collection = m[2] ?? ''
  const rkey = m[3] ?? ''
  return `https://www.hyperscan.dev/data?did=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`
}

export type MintHypercertInput = {
  title: string
  shortDescription: string
  workScope: string
}

export async function mintHypercertActivity(input: MintHypercertInput): Promise<
  | { skipped: true; reason: string }
  | { uri: string; cid: string; hyperscanUrl: string }
> {
  if (!isHypercertEnabled()) return { skipped: true, reason: 'HYPERCERT_ENABLED=false' }

  const identifier = process.env.BSKY_IDENTIFIER
  const password = process.env.BSKY_APP_PASSWORD
  if (!identifier || !password) return { skipped: true, reason: 'Missing BSKY credentials' }

  const agent = new AtpAgent({ service: BSKY_SERVICE })
  await agent.login({ identifier, password })

  const record = {
    $type: COLLECTION,
    title: String(input.title || 'TapTrading Activity').slice(0, 256),
    shortDescription: String(input.shortDescription || 'Verifiable activity record').slice(0, 500),
    createdAt: new Date().toISOString(),
    workScope: String(input.workScope || 'taptrading-activity').slice(0, 300)
  }

  const result = await agent.com.atproto.repo.createRecord({
    repo: agent.session?.did ?? '',
    collection: COLLECTION,
    record
  })

  const uri = result.data.uri
  return {
    uri,
    cid: result.data.cid,
    hyperscanUrl: hyperscanUrlFromAtUri(uri)
  }
}

export async function mintDepositHypercertAndLog(details: {
  depositId: string
  walletAddress: string
  amountMist: string
  balanceMist: string
  nonce: string
}) {
  try {
    const res = await mintHypercertActivity({
      title: `TapTrading: Deposit credited`,
      shortDescription: `Deposit ${details.depositId} credited for ${details.walletAddress}. Amount(base units): ${details.amountMist}. New balance: ${details.balanceMist}. Nonce: ${details.nonce}.`,
      workScope: 'taptrading deposit credit'
    })

    if ('uri' in res) {
      logger.info(
        {
          depositId: details.depositId,
          walletAddress: details.walletAddress,
          amountMist: details.amountMist,
          balanceMist: details.balanceMist,
          nonce: details.nonce,
          hypercertUri: res.uri,
          hypercertCid: res.cid,
          hyperscanUrl: res.hyperscanUrl
        },
        '[Hypercert] Deposit proof minted'
      )
      return
    }

    logger.info({ depositId: details.depositId, reason: res.reason }, '[Hypercert] Deposit proof skipped')
  } catch (err) {
    logger.error({ err, depositId: details.depositId }, '[Hypercert] Deposit proof mint failed')
  }
}

