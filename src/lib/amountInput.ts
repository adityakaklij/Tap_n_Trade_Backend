import Decimal from 'decimal.js'
import { TRADING } from '../config/constants.js'
import { HttpError } from '../http/errors.js'

export type AmountBodyFields = {
  amountMist?: string | number
  /** Human OCT amount, e.g. `"0.1"` → base units using `TRADING.TOKEN_DECIMALS`. */
  amountOct?: string
}

/**
 * Resolves API amount to integer base-unit string (same scale as `balanceMist`).
 * - `amountMist`: non-negative integer as string **or** JSON number (e.g. `1000` or `"1000"`).
 * - `amountOct`: decimal string, e.g. `0.1` with 4 decimals → `1000` base units.
 */
export function resolveAmountMistString(fields: AmountBodyFields): string {
  const octRaw = fields.amountOct
  const hasOct = octRaw != null && String(octRaw).trim() !== ''

  const mistRaw = fields.amountMist
  const hasMist =
    mistRaw !== undefined &&
    mistRaw !== '' &&
    !(typeof mistRaw === 'string' && mistRaw.trim() === '') &&
    !(typeof mistRaw === 'number' && Number.isNaN(mistRaw))

  if (hasOct && hasMist) throw new HttpError(400, 'UseAmountMistOrAmountOctNotBoth')
  if (!hasOct && !hasMist) throw new HttpError(400, 'AmountRequired')

  if (hasOct) {
    const d = new Decimal(String(octRaw).trim())
    if (!d.isFinite() || d.lte(0)) throw new HttpError(400, 'InvalidAmount')
    return d.times(new Decimal(10).pow(TRADING.TOKEN_DECIMALS)).toFixed(0, Decimal.ROUND_DOWN)
  }

  const v = mistRaw!
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) throw new HttpError(400, 'InvalidAmount')
    return String(v)
  }
  const t = v.trim()
  if (!/^\d+$/.test(t)) throw new HttpError(400, 'InvalidAmount')
  return t
}
