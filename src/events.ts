import { EventEmitter } from 'node:events'

export type PriceTickEvent = {
  type: 'price.tick'
  tokenPairId: string
  symbol: string
  t: string
  price: string
}

export type RoundEvent =
  | { type: 'round.open'; tokenPairId: string; symbol: string; roundId: string; roundNumber: number; openTime: string; closeTime: string }
  | { type: 'round.close'; tokenPairId: string; symbol: string; roundId: string; roundNumber: number; closeTime: string }
  | { type: 'round.settled'; tokenPairId: string; symbol: string; roundId: string; roundNumber: number; settlementPrice: string; settledAt: string }

export type GridSnapshotEvent = {
  type: 'grid.snapshot'
  tokenPairId: string
  symbol: string
  roundId: string
  roundNumber: number
  price: string
  sigma: number
  rawGrid: string
  gridSize: string
  top: string
  bottom: string
  cells: Array<{
    cellIndex: number
    zoneLow: string
    zoneHigh: string
    probability: number
    baseMultiplier: number
    adjustedMultiplier: number
    totalStakeMist: string
  }>
}

export type AppEvent = PriceTickEvent | RoundEvent | GridSnapshotEvent

class AppEventBus extends EventEmitter {
  emitEvent(evt: AppEvent) {
    this.emit('event', evt)
    this.emit(evt.type, evt)
  }
}

export const eventBus = new AppEventBus()

