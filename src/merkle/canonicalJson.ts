function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v == null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize)
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k])
    return out
  }
  return v
}

export function canonicalJsonStringify(v: unknown): string {
  return JSON.stringify(canonicalize(v))
}

