import { Router } from 'express'
import { usersRouter } from './routes/users.js'
import { tokenPairsRouter } from './routes/tokenPairs.js'
import { roundsRouter } from './routes/rounds.js'
import { betsRouter } from './routes/bets.js'
import { depositsRouter } from './routes/deposits.js'
import { withdrawalsRouter } from './routes/withdrawals.js'
import { merkleRouter } from './routes/merkle.js'

export function createRouter() {
  const r = Router()
  r.get('/health', (_req, res) => res.json({ ok: true }))
  r.use(usersRouter)
  r.use(tokenPairsRouter)
  r.use(roundsRouter)
  r.use(betsRouter)
  r.use(depositsRouter)
  r.use(withdrawalsRouter)
  r.use(merkleRouter)
  return r
}

