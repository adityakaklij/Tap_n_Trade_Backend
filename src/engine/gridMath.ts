import Decimal from 'decimal.js'

// --- Normal CDF helpers (no external deps) ---
// Abramowitz and Stegun approximation for erf
function erf(x: number): number {
  // save the sign of x
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)

  // constants
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const t = 1 / (1 + p * ax)
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax)
  return sign * y
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

export type VolatilityResult = {
  sigma: number // per tick
  meanReturn: number
  returns: number[]
}

export function computeReturns(prices: Decimal[]): number[] {
  const rs: number[] = []
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]
    const cur = prices[i]
    if (!prev || !cur) continue
    if (prev.isZero()) continue
    const r = cur.minus(prev).div(prev).toNumber()
    rs.push(r)
  }
  return rs
}

export function computeVolatilityFromReturns(returns: number[]): VolatilityResult {
  const n = returns.length
  if (n === 0) return { sigma: 0, meanReturn: 0, returns }
  const mean = returns.reduce((a, b) => a + b, 0) / n
  const variance = returns.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / n
  return { sigma: Math.sqrt(variance), meanReturn: mean, returns }
}

export function computeVolatility(prices: Decimal[], lastNReturns: number): VolatilityResult {
  const rs = computeReturns(prices)
  const last = rs.slice(Math.max(0, rs.length - lastNReturns))
  return computeVolatilityFromReturns(last)
}

export function roundCleanGrid(rawGrid: Decimal): Decimal {
  if (rawGrid.lte(0)) return new Decimal(0)
  const raw = rawGrid.toNumber()
  if (!Number.isFinite(raw) || raw <= 0) return new Decimal(0)

  // Use "nice number" steps (1, 2, 5) per magnitude to avoid sticky rounding.
  // This tends to move more often than Math.round(raw/mag)*mag.
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const scaled = raw / magnitude
  const steps = [1, 2, 5, 10]

  let best = steps[0]!
  let bestDiff = Math.abs(scaled - best)
  for (const s of steps) {
    const diff = Math.abs(scaled - s)
    if (diff < bestDiff) {
      best = s
      bestDiff = diff
    }
  }
  const clean = best * magnitude
  return new Decimal(clean)
}

export type Cell = {
  cellIndex: number // 1..N (top to bottom)
  zoneLow: Decimal
  zoneHigh: Decimal
  center: Decimal
}

export function buildGrid(P: Decimal, gridSize: Decimal, cellCount: number): { top: Decimal; bottom: Decimal; cells: Cell[] } {
  const half = cellCount / 2
  const top = P.plus(gridSize.times(half))
  const bottom = P.minus(gridSize.times(half))

  const cells: Cell[] = []
  for (let k = 1; k <= cellCount; k++) {
    const zoneHigh = top.minus(gridSize.times(k - 1))
    const zoneLow = top.minus(gridSize.times(k))
    const center = top.minus(gridSize.times(k - 0.5))
    cells.push({ cellIndex: k, zoneLow, zoneHigh, center })
  }
  return { top, bottom, cells }
}

export function currentCellIndexZeroBased(top: Decimal, P: Decimal, gridSize: Decimal): number {
  // matches calculations.txt: floor((Top - P) / Grid)
  if (gridSize.lte(0)) return 0
  return Math.floor(top.minus(P).div(gridSize).toNumber())
}

export type ProbabilityInputs = {
  P: Decimal
  sigma: number // per tick (std dev of returns)
  T: number // ticks per round (use 1 when using per-tick sigma)
}

export function cellProbability(zoneLow: Decimal, zoneHigh: Decimal, inputs: ProbabilityInputs): number {
  const { P, sigma, T } = inputs
  if (sigma <= 0 || T <= 0) return 0
  const denom = P.toNumber() * sigma * Math.sqrt(T)
  if (!Number.isFinite(denom) || denom <= 0) return 0

  const zLow = (zoneLow.toNumber() - P.toNumber()) / denom
  const zHigh = (zoneHigh.toNumber() - P.toNumber()) / denom
  const p = normalCdf(zHigh) - normalCdf(zLow)
  // clamp to avoid divide-by-zero / negative due to numeric error
  return Math.max(0, Math.min(1, p))
}

export function baseMultiplier(prob: number, houseEdgeH: number): number {
  if (prob <= 0) return 0
  return (1 - houseEdgeH) / prob
}

export function scaleMultipliersByProbability(probs: number[], minMult: number, maxMult: number): number[] {
  if (probs.length === 0) return []
  const safeMin = Number.isFinite(minMult) ? minMult : 1
  const safeMax = Number.isFinite(maxMult) ? maxMult : safeMin
  if (safeMax <= safeMin) return probs.map(() => safeMin)

  // Map highest probability -> min, lowest probability -> max.
  const inv = probs.map((p) => (p > 0 ? 1 / p : Number.POSITIVE_INFINITY))
  const finiteInv = inv.filter((x) => Number.isFinite(x))
  const minInv = Math.min(...finiteInv)
  const maxInv = Math.max(...finiteInv)
  if (!Number.isFinite(minInv) || !Number.isFinite(maxInv) || maxInv === minInv) {
    return probs.map(() => safeMin)
  }

  return inv.map((x) => {
    if (!Number.isFinite(x)) return safeMax
    const t = (x - minInv) / (maxInv - minInv)
    const m = safeMin + t * (safeMax - safeMin)
    return Math.max(safeMin, Math.min(safeMax, m))
  })
}

export function adjustedMultiplier(base: number, totalStakeInCellMist: Decimal, poolCapacityMist: Decimal, dampeningFactor: number): number {
  if (base <= 0) return 0
  if (poolCapacityMist.lte(0)) return base
  const exposureRatio = totalStakeInCellMist.div(poolCapacityMist).toNumber()
  const adj = base * (1 - exposureRatio * dampeningFactor)
  return Math.max(0, adj)
}

