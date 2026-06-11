import {config} from './config'

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const zonedPartsFormatters = new Map<string, Intl.DateTimeFormat>()
const zonedOffsetFormatters = new Map<string, Intl.DateTimeFormat>()

function getZonedPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedPartsFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    zonedPartsFormatters.set(timeZone, formatter)
  }
  
  return formatter
}

function getZonedOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedOffsetFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'longOffset',
    })
    zonedOffsetFormatters.set(timeZone, formatter)
  }
  
  return formatter
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getZonedPartsFormatter(timeZone).formatToParts(date)
  
  const lookup = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find(part => part.type === type)?.value
    if (!value) throw new Error(`Missing ${type} for timezone ${timeZone}`)
    return Number.parseInt(value, 10)
  }
  
  return {
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
    hour: lookup('hour'),
    minute: lookup('minute'),
    second: lookup('second'),
  }
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getZonedOffsetFormatter(timeZone).formatToParts(date)
  const offsetText = parts.find(part => part.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const match = offsetText.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  
  if (!match) {
    throw new Error(`Unsupported timezone offset format: ${offsetText}`)
  }
  
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number.parseInt(match[2], 10)
  const minutes = Number.parseInt(match[3] || '0', 10)
  return sign * (hours * 60 + minutes)
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone)
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}.${milliseconds}`
}

function zonedTimeToUtc(
    timeZone: string,
    parts: ZonedParts & { millisecond: number },
): Date {
  const utcGuess = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
  )
  
  let offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone)
  let adjustedUtc = utcGuess - offsetMinutes * 60_000
  
  const correctedOffsetMinutes = getTimeZoneOffsetMinutes(new Date(adjustedUtc), timeZone)
  if (correctedOffsetMinutes !== offsetMinutes) {
    adjustedUtc = utcGuess - correctedOffsetMinutes * 60_000
  }
  
  return new Date(adjustedUtc)
}

export function nowISO(): string {
  return formatDateInTimeZone(new Date(), config.timezone)
}

export function daysAgoISO(days: number): string {
  const now = new Date()
  const parts = getZonedParts(now, config.timezone)
  const target = zonedTimeToUtc(config.timezone, {
    ...parts,
    day: parts.day - days,
    millisecond: now.getMilliseconds(),
  })
  
  return formatDateInTimeZone(target, config.timezone)
}

export function msUntilNextMidnight(): number {
  const now = new Date()
  const parts = getZonedParts(now, config.timezone)
  const nextMidnight = zonedTimeToUtc(config.timezone, {
    year: parts.year,
    month: parts.month,
    day: parts.day + 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  })
  
  return Math.max(0, nextMidnight.getTime() - now.getTime())
}

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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatUptime(startedAt: string): string {
  try {
    const start = new Date(startedAt)
    const diffMs = Date.now() - start.getTime()
    if (diffMs < 0) return ''
    const seconds = Math.floor(diffMs / 1000)
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  } catch {
    return ''
  }
}
