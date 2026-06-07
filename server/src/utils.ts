const SAFE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Internal Server Error'
}

export function isSafeFieldName(field: string): boolean {
  return SAFE_FIELD_NAME.test(field)
}

export function assertSafeFieldName(field: string): string {
  if (!isSafeFieldName(field)) {
    throw new Error('Invalid field name')
  }

  return field
}

export function escapeClickHouseString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function parseInteger(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed)) {
      return parsed
    }
  }

  return fallback
}
