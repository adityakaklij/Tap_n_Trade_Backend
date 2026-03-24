import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  MONGODB_URI: z.string().min(1).optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.string().optional(),
  BINANCE_WS_BASE: z.string().min(1).default('wss://stream.binance.com:9443/ws'),
  HYPERCERT_ENABLED: z.string().optional(),
  BSKY_IDENTIFIER: z.string().optional(),
  BSKY_APP_PASSWORD: z.string().optional()
})

export type Env = Omit<z.infer<typeof EnvSchema>, 'MONGODB_URI'> & { MONGODB_URI: string }

export function loadEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.parse(raw)
  if (parsed.MONGODB_URI) return { ...parsed, MONGODB_URI: parsed.MONGODB_URI }

  // Derive from DB_* if present (matches user's current .env shape)
  const { DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT } = parsed
  if (DB_HOST && DB_PORT && DB_NAME && DB_USER && DB_PASSWORD) {
    const auth = `${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}`
    return { ...parsed, MONGODB_URI: `mongodb://${auth}@${DB_HOST}:${DB_PORT}/${DB_NAME}` }
  }

  // Local dev fallback (so server can boot)
  return { ...parsed, MONGODB_URI: 'mongodb://127.0.0.1:27017/taptrading' }
}

