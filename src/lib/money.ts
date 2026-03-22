import Decimal from 'decimal.js'
import mongoose from 'mongoose'

export function decFromDb(v: unknown): Decimal {
  if (v == null) return new Decimal(0)
  if (typeof v === 'string') return new Decimal(v)
  if (typeof v === 'number') return new Decimal(v)
  if (typeof v === 'bigint') return new Decimal(v.toString())
  if (v instanceof Decimal) return v

  // Mongoose Decimal128
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyV = v as any
  if (anyV?.toString) return new Decimal(anyV.toString())
  return new Decimal(0)
}

export function dbDecimal(v: Decimal.Value): mongoose.Types.Decimal128 {
  const d = new Decimal(v)
  return mongoose.Types.Decimal128.fromString(d.toFixed(0))
}

export function dbDecimalPrice(v: Decimal.Value): mongoose.Types.Decimal128 {
  const d = new Decimal(v)
  return mongoose.Types.Decimal128.fromString(d.toString())
}

