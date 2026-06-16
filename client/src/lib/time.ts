function buildFormatter(timezone?: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
}

const zonedPartsFormatters = new Map<string, Intl.DateTimeFormat>()

export interface TimeRange {
    startTime?: string
    endTime?: string
}

export type TimePreset = 'last15m' | 'last1h' | 'last6h' | 'today' | 'yesterday' | 'last7d'

export function formatTimestamp(timestamp: string | null, timezone?: string): string {
    if (!timestamp) return ''
    
    try {
        const date = new Date(timestamp)
        if (Number.isNaN(date.getTime())) return timestamp
        return buildFormatter(timezone).format(date)
    } catch {
        return timestamp
    }
}

export function formatInstanceLabel(startedAt: string, status: 'running' | 'stopped', timezone?: string): string {
    const formatted = formatTimestamp(startedAt, timezone)
    if (!formatted) return status === 'running' ? '(running)' : ''
    return `${formatted}${status === 'running' ? ' (running)' : ''}`
}

function getZonedPartsFormatter(timezone: string): Intl.DateTimeFormat {
    let formatter = zonedPartsFormatters.get(timezone)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        })
        zonedPartsFormatters.set(timezone, formatter)
    }

    return formatter
}

function getZonedParts(date: Date, timezone: string) {
    const parts = getZonedPartsFormatter(timezone).formatToParts(date)
    const lookup = (type: Intl.DateTimeFormatPartTypes) => {
        const value = parts.find(part => part.type === type)?.value
        return value ? Number.parseInt(value, 10) : 0
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

function pad(value: number): string {
    return String(value).padStart(2, '0')
}

export function formatDateTimeLocalInTimezone(date: Date, timezone?: string): string {
    const parts = timezone ? getZonedParts(date, timezone) : {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
    }

    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

export function buildTimePresetRange(preset: TimePreset, timezone?: string): TimeRange {
    const now = new Date()
    const zonedNow = getZonedParts(now, timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    const currentDay = `${zonedNow.year}-${pad(zonedNow.month)}-${pad(zonedNow.day)}`

    switch (preset) {
        case 'last15m':
            return {startTime: formatDateTimeLocalInTimezone(new Date(now.getTime() - 15 * 60 * 1000), timezone)}
        case 'last1h':
            return {startTime: formatDateTimeLocalInTimezone(new Date(now.getTime() - 60 * 60 * 1000), timezone)}
        case 'last6h':
            return {startTime: formatDateTimeLocalInTimezone(new Date(now.getTime() - 6 * 60 * 60 * 1000), timezone)}
        case 'today':
            return {startTime: `${currentDay}T00:00`}
        case 'yesterday': {
            const previous = getZonedParts(new Date(now.getTime() - 24 * 60 * 60 * 1000), timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
            const previousDay = `${previous.year}-${pad(previous.month)}-${pad(previous.day)}`
            return {startTime: `${previousDay}T00:00`, endTime: `${previousDay}T23:59`}
        }
        case 'last7d':
            return {startTime: formatDateTimeLocalInTimezone(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), timezone)}
    }
}

export function datetimeLocalToStorageTimestamp(value: string | undefined, endOfMinute = false): string | undefined {
    if (!value) return undefined
    const normalized = value.replace('T', ' ')
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
        return `${normalized}:${endOfMinute ? '59.999' : '00.000'}`
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
        return `${normalized}${endOfMinute ? '.999' : '.000'}`
    }
    return normalized
}

export function timeRangeToQuery(range: TimeRange): TimeRange {
    return {
        startTime: datetimeLocalToStorageTimestamp(range.startTime),
        endTime: datetimeLocalToStorageTimestamp(range.endTime, true),
    }
}

export function timestampToComparableStorageValue(timestamp: string | null, timezone?: string): string | null {
    if (!timestamp) return null

    if (timezone && /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(timestamp)) {
        const parsed = new Date(timestamp)
        if (!Number.isNaN(parsed.getTime())) {
            return `${formatDateTimeLocalInTimezone(parsed, timezone).replace('T', ' ')}:${pad(getZonedParts(parsed, timezone).second)}.${String(parsed.getMilliseconds()).padStart(3, '0')}`
        }
    }

    return datetimeLocalToStorageTimestamp(timestamp.slice(0, 19).replace(' ', 'T')) ?? timestamp
}
