import WebSocket from 'ws'
import Decimal from 'decimal.js'
import { TokenPairModel, PriceTickModel } from '../models/index.js'
import { dbDecimalPrice } from '../lib/money.js'
import { logger } from '../lib/logger.js'
import { eventBus } from '../events.js'

type ConnectionState = {
  ws: WebSocket
  symbol: string
  tokenPairId: string
  latestPrice?: Decimal
  latestTradeTime?: Date
  sampler: NodeJS.Timeout | undefined
}

export class BinanceIngest {
  private readonly conns = new Map<string, ConnectionState>() // tokenPairId -> state

  constructor(private readonly wsBase: string) {}

  async start() {
    const pairs = await TokenPairModel.find({ isActive: true }).lean()
    for (const p of pairs) {
      await this.ensureRunning(p._id.toString(), p.symbol, p.tickIntervalSec)
    }
  }

  async refreshFromDb() {
    const pairs = await TokenPairModel.find({ isActive: true }).lean()
    const activeIds = new Set(pairs.map((p) => p._id.toString()))
    for (const p of pairs) {
      await this.ensureRunning(p._id.toString(), p.symbol, p.tickIntervalSec)
    }
    for (const [tokenPairId, st] of this.conns.entries()) {
      if (!activeIds.has(tokenPairId)) {
        this.stopOne(st)
        this.conns.delete(tokenPairId)
      }
    }
  }

  private async ensureRunning(tokenPairId: string, symbol: string, tickIntervalSec: number) {
    const existing = this.conns.get(tokenPairId)
    if (existing) return

    const stream = `${symbol.toLowerCase()}@trade`
    const url = `${this.wsBase}/${stream}`

    const ws = new WebSocket(url)
    const state: ConnectionState = { ws, symbol, tokenPairId, sampler: undefined }
    this.conns.set(tokenPairId, state)

    ws.on('open', () => {
      logger.info({ symbol, url }, 'Binance WS connected')
      state.sampler = setInterval(() => void this.sampleTick(state), tickIntervalSec * 1000)
    })

    ws.on('message', (buf) => {
      try {
        const msg = JSON.parse(buf.toString()) as { p?: string; T?: number }
        if (!msg.p) return
        state.latestPrice = new Decimal(msg.p)
        state.latestTradeTime = msg.T ? new Date(msg.T) : new Date()
      } catch (err) {
        logger.warn({ err, symbol }, 'Failed to parse Binance message')
      }
    })

    ws.on('close', (code) => {
      logger.warn({ symbol, code }, 'Binance WS closed')
      this.stopOne(state)
      this.conns.delete(tokenPairId)
      setTimeout(() => void this.ensureRunning(tokenPairId, symbol, tickIntervalSec), 1500).unref()
    })

    ws.on('error', (err) => {
      logger.warn({ err, symbol }, 'Binance WS error')
    })
  }

  private stopOne(st: ConnectionState) {
    if (st.sampler) clearInterval(st.sampler)
    st.sampler = undefined
    try {
      st.ws.close()
    } catch {
      // ignore
    }
  }

  private async sampleTick(st: ConnectionState) {
    if (!st.latestPrice) return
    const t = new Date()

    await PriceTickModel.create({
      tokenPairId: st.tokenPairId,
      t,
      price: dbDecimalPrice(st.latestPrice)
    })

    eventBus.emitEvent({
      type: 'price.tick',
      tokenPairId: st.tokenPairId,
      symbol: st.symbol,
      t: t.toISOString(),
      price: st.latestPrice.toString()
    })
  }
}

