import type {LogEntry} from '../types'

export interface ResolvedLogEntry extends LogEntry {
    derivedFields: Record<string, unknown> | null
}

export function resolveLogEntry(entry: LogEntry): ResolvedLogEntry {
    const derivedFields = parseObject(entry.parsedJson) ?? parseObject(entry.rawContent)
    const timestamp = entry.timestamp ?? extractTimestamp(derivedFields) ?? extractTimestampFromText(entry.rawContent)
    const level = entry.level ?? extractLevel(derivedFields)
    const content = shouldUseStoredContent(entry) ? entry.content : extractContent(derivedFields) ?? entry.rawContent
    const sql = entry.sql ?? findSqlField(derivedFields)
    const isJson = entry.isJson || derivedFields !== null
    const parsedJson = entry.parsedJson ?? (derivedFields ? JSON.stringify(derivedFields) : null)

    return {
        ...entry,
        timestamp,
        level,
        content,
        isJson,
        parsedJson,
        hasSql: entry.hasSql || sql !== null,
        sql,
        derivedFields,
    }
}

export function getLogFieldValue(entry: ResolvedLogEntry, field: string): string {
    if (!field) return '(none)'
    const normalizedField = field.trim()
    if (!normalizedField) return '(none)'

    const directValue = entry.derivedFields?.[normalizedField]
    if (directValue != null) {
        return stringifyValue(directValue)
    }

    if (normalizedField === 'level' && entry.level) return entry.level
    if (normalizedField === 'content' && entry.content) return entry.content
    if (normalizedField === 'timestamp' && entry.timestamp) return entry.timestamp

    return '(none)'
}

export function getDistinctLevels(entries: ResolvedLogEntry[]): string[] {
    const seen = new Set<string>()

    for (const entry of entries) {
        if (!entry.level) continue
        seen.add(entry.level)
    }

    return Array.from(seen).sort((left, right) => left.localeCompare(right))
}

function shouldUseStoredContent(entry: LogEntry): boolean {
    return entry.content !== entry.rawContent || entry.parsedJson !== null || entry.isJson
}

function parseObject(input: string | null): Record<string, unknown> | null {
    if (!input) return null

    try {
        const parsed = JSON.parse(input)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>
        }
    } catch {
    }

    return null
}

function extractTimestamp(fields: Record<string, unknown> | null): string | null {
    if (!fields) return null

    for (const key of ['@timestamp', 'timestamp', 'time', 'ts', 'date', 'datetime']) {
        if (typeof fields[key] === 'string') return fields[key] as string
    }

    return null
}

function extractLevel(fields: Record<string, unknown> | null): string | null {
    if (!fields) return null

    for (const key of ['level', 'severity', 'lvl', 'loglevel']) {
        if (fields[key] !== undefined) return String(fields[key])
    }

    return null
}

function extractContent(fields: Record<string, unknown> | null): string | null {
    if (!fields) return null

    for (const key of ['content', 'message', 'msg', 'text', 'log']) {
        if (typeof fields[key] === 'string') return fields[key] as string
    }

    return JSON.stringify(fields)
}

function findSqlField(fields: Record<string, unknown> | null): string | null {
    if (!fields) return null

    for (const key of Object.keys(fields)) {
        const lowerKey = key.toLowerCase()
        if (lowerKey !== 'sql' && lowerKey !== 'query' && lowerKey !== 'statement') {
            continue
        }

        const value = fields[key]
        if (typeof value === 'string' && looksLikeSql(value)) {
            return value
        }
    }

    return null
}

function looksLikeSql(text: string): boolean {
    const upper = text.substring(0, 50).toUpperCase()
    return /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|EXPLAIN)\s/.test(upper.trim())
}

function extractTimestampFromText(line: string): string | null {
    const match = line.match(/\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}/)
    return match ? match[0] : null
}

function stringifyValue(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return JSON.stringify(value)
}
