export interface ParsedLog {
  raw: string
  isJson: boolean
  json: Record<string, unknown> | null
  timestamp: string | null
  level: string | null
  content: string
  fields: Record<string, unknown>
  hasSql: boolean
  sql: string | null
}

export function parseLogLine(line: string): ParsedLog {
  const result: ParsedLog = {
    raw: line,
    isJson: false,
    json: null,
    timestamp: null,
    level: null,
    content: line,
    fields: {},
    hasSql: false,
    sql: null,
  }
  
  // Try JSON parse
  try {
    const obj = JSON.parse(line)
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      result.isJson = true
      result.json = obj as Record<string, unknown>
      result.timestamp = extractTimestamp(obj)
      result.level = extractLevel(obj)
      result.content = extractContent(obj)
      result.fields = obj
      
      // Check for SQL field
      const sql = findSqlField(obj)
      if (sql) {
        result.hasSql = true
        result.sql = sql
      }
    }
  } catch {
    // Not JSON, treat as plain text
    result.isJson = false
    result.timestamp = extractTimestampFromText(line)
    result.content = line
  }
  
  return result
}

function extractTimestamp(obj: Record<string, unknown>): string | null {
  for (const key of ['@timestamp', 'timestamp', 'time', 'ts', 'date', 'datetime']) {
    if (typeof obj[key] === 'string') return obj[key] as string
  }
  return null
}

function extractLevel(obj: Record<string, unknown>): string | null {
  for (const key of ['level', 'severity', 'lvl', 'loglevel']) {
    if (obj[key] !== undefined) return String(obj[key])
  }
  return null
}

function extractContent(obj: Record<string, unknown>): string {
  for (const key of ['content', 'message', 'msg', 'text', 'log']) {
    if (typeof obj[key] === 'string') return obj[key] as string
  }
  return JSON.stringify(obj)
}

function findSqlField(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase()
    if (lower === 'sql' || lower === 'query' || lower === 'statement') {
      const val = obj[key]
      if (typeof val === 'string' && looksLikeSql(val)) {
        return val
      }
    }
  }
  return null
}

function looksLikeSql(text: string): boolean {
  const upper = text.substring(0, 50).toUpperCase()
  return /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|EXPLAIN)\s/.test(upper.trim())
}

function extractTimestampFromText(line: string): string | null {
  // Try common patterns: [2024-01-01 12:00:00] or 2024/01/01 12:00:00
  const match = line.match(/\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}/)
  return match ? match[0] : null
}
