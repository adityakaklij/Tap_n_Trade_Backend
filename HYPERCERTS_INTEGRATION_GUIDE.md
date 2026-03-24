# Hypercerts Integration Guide (Use Anywhere)

This document gives you a single, portable setup to integrate Hypercert attestations into any Node.js app.

It is based on the working integration in this project and can be reused with minimal edits.

---

## What You Need

- Node.js app (CommonJS or ESM)
- A Bluesky account
- Bluesky App Password (`Settings -> App Passwords`)
- npm package: `@atproto/api`

Install dependency:

```bash
npm install @atproto/api
```

---

## Environment Variables

Add this to your `.env`:

```env
# Toggle attestations
HYPERCERT_ENABLED=true

# Bluesky credentials (required for minting)
BSKY_IDENTIFIER=your-handle.bsky.social
BSKY_APP_PASSWORD=xxxx-xxxx-xxxx
```

If `HYPERCERT_ENABLED=false`, your app should skip minting safely.

---

## Drop-In Hypercert Client (Node.js)

Create `hypercert-client.js`:

```js
const { AtpAgent } = require('@atproto/api');

const BSKY_SERVICE = 'https://bsky.social';
const COLLECTION = 'org.hypercerts.claim.activity';

function hyperscanUrlFromAtUri(atUri) {
  const m = String(atUri).match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return `https://www.hyperscan.dev/data?uri=${encodeURIComponent(atUri)}`;
  const [, did, collection, rkey] = m;
  return `https://www.hyperscan.dev/data?did=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
}

async function mintHypercertActivity({
  title,
  shortDescription,
  workScope = 'autonomous-agent-activity',
  enabled = process.env.HYPERCERT_ENABLED === 'true',
  identifier = process.env.BSKY_IDENTIFIER,
  password = process.env.BSKY_APP_PASSWORD,
}) {
  if (!enabled) return { skipped: true, reason: 'HYPERCERT_ENABLED=false' };
  if (!identifier || !password) return { skipped: true, reason: 'Missing BSKY credentials' };

  const agent = new AtpAgent({ service: BSKY_SERVICE });
  await agent.login({ identifier, password });

  const record = {
    $type: COLLECTION,
    title: String(title || 'Agent Activity').slice(0, 256),
    shortDescription: String(shortDescription || 'Verifiable activity record').slice(0, 500),
    createdAt: new Date().toISOString(),
    workScope: String(workScope).slice(0, 300),
  };

  const result = await agent.com.atproto.repo.createRecord({
    repo: agent.session.did,
    collection: COLLECTION,
    record,
  });

  const uri = result.data.uri;
  return {
    uri,
    cid: result.data.cid,
    hyperscanUrl: hyperscanUrlFromAtUri(uri),
  };
}

module.exports = { mintHypercertActivity, hyperscanUrlFromAtUri };
```

---

## How To Call It In Your App

Call minting only after a real action succeeds (trade executed, payout completed, job finalized, etc.).

```js
const { mintHypercertActivity } = require('./hypercert-client');

async function onActionExecuted(actionResult) {
  if (!actionResult?.success) return;

  const attestation = await mintHypercertActivity({
    title: `MyAgent: Executed ${actionResult.action} ${actionResult.token}`,
    shortDescription: `Reason: ${actionResult.reasoning}. Confidence: ${actionResult.confidence}%. Amount: $${actionResult.amount}.`,
    workScope: `crypto-trading ${actionResult.action} ${actionResult.token}`,
  });

  if (attestation?.uri) {
    console.log('Hypercert URI:', attestation.uri);
    console.log('Hyperscan URL:', attestation.hyperscanUrl);

    // Optional: persist URI in your DB
    // await TradeLog.updateOne({ _id: actionResult.tradeId }, { $set: { hypercertUri: attestation.uri } });
  } else {
    console.log('Attestation skipped/error:', attestation);
  }
}
```

---

## Recommended Integration Pattern

- Mint only for meaningful state changes (`BUY`, `SELL`, `EXECUTED`, etc.)
- Skip attestations for no-op events (`HOLD`, `amount=0`, validation failures)
- Store `uri` in your database for auditability
- Expose `hyperscanUrl` in UI, notifications, logs, or Telegram
- Keep minting non-blocking for critical flows (log errors; do not crash the app)

---

## Minimal Error Handling

Use this pattern so your core app still works if Hypercert minting fails:

```js
let attestation = null;
try {
  attestation = await mintHypercertActivity({
    title: 'SMAF: Executed BUY BTC',
    shortDescription: 'Market signal triggered buy. Confidence 72%.',
    workScope: 'crypto-trading buy BTC',
  });
} catch (e) {
  console.error('[Hypercert] Mint failed:', e.message);
}
```

---

## Validation Checklist

- `@atproto/api` installed
- `HYPERCERT_ENABLED=true`
- `BSKY_IDENTIFIER` and `BSKY_APP_PASSWORD` set correctly
- Mint call runs after successful action
- Returned `uri` is saved
- `hyperscanUrl` opens and shows record

---

## Project-Specific Reference (This Repo)

If you want to reuse the exact implementation from this project:

- Core client: `src/hypercert/client.js`
- Pipeline hook: `src/orchestrator.js`
- Env config: `.env.example` and `config/constants.js`

These files already implement:

- Trade attestation minting
- Deposit attestation minting
- Safe skip logic when disabled/missing credentials
- Direct Hyperscan URL generation from `at://` URI

