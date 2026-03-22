/**
 * In-app balance / deposits use integer **base units** (same field name as MIST elsewhere: `*Mist`).
 * For display, e.g. **OCT** with 4 decimals: `0.1` OCT → `1000` base units (`0.1 × 10^4`).
 */
export const TRADING = {
  /** Human token decimals (OCT-style). Override via env `TRADING_TOKEN_DECIMALS` in `loadEnv` if added later. */
  TOKEN_DECIMALS: 4
} as const

export const MERKLE = {
  // Default is 60 minutes. Keep this as a constant so tests can shorten it.
  CHECKPOINT_INTERVAL_MS: 60 * 60 * 1000,

  // Tree padding uses hash("EMPTY") for missing leaves
  EMPTY_LEAF_SENTINEL: 'EMPTY',

  // If enabled, checkpoint builder can clamp to not run too frequently.
  // (Set to 0 to disable throttling.)
  MIN_BUILD_GAP_MS: 5_000,

  /** When true, POST /withdrawals requires a confirmed checkpoint covering all prior user activity. */
  WITHDRAWAL_REQUIRES_CONFIRMED_CHECKPOINT: true,

  /**
   * Until real Sui submission exists: flip built → submitted → confirmed in DB and set a fake chainTxHash.
   * Set false in production until the chain worker marks checkpoints confirmed.
   */
  SIMULATE_CHAIN_CONFIRMATION: true,

  /** Delay before marking a checkpoint confirmed (simulates chain finality). */
  SIMULATED_CHAIN_CONFIRMATION_DELAY_MS: 1_000,

  /** Prefix for SIMULATE_CHAIN_CONFIRMATION tx hashes (not a real on-chain tx). */
  SIMULATED_CHAIN_TX_HASH_PREFIX: '0xSIMULATED_'
} as const

