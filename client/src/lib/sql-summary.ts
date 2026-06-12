export interface SqlSummary {
    action: string
    primaryTable: string | null
    joinedTables: string[]
}

interface SqlToken {
    value: string
    lower: string
    depth: number
}

const ACTIONS = new Set([
    'select',
    'insert',
    'update',
    'delete',
    'replace',
    'create',
    'alter',
    'drop',
    'truncate',
    'merge',
])

const TABLE_SKIP_WORDS = new Set(['if', 'not', 'exists', 'only'])

export function summarizeSql(sql: string): SqlSummary {
    const tokens = tokenizeSql(sql)
    const actionIndex = tokens.findIndex(token => token.depth === 0 && ACTIONS.has(token.lower))
    const action = actionIndex >= 0 ? tokens[actionIndex].lower : 'sql'
    const primaryTable = extractPrimaryTable(tokens, action, actionIndex)
    const joinedTables = extractJoinedTables(tokens, primaryTable)
    
    return {
        action,
        primaryTable,
        joinedTables,
    }
}

function extractPrimaryTable(tokens: SqlToken[], action: string, actionIndex: number): string | null {
    if (actionIndex < 0) return null
    
    if (action === 'select' || action === 'delete' || action === 'merge') {
        const fromIndex = findTopLevelToken(tokens, 'from', actionIndex + 1)
        return fromIndex >= 0 ? readTableAfter(tokens, fromIndex + 1, 0) : null
    }
    
    if (action === 'insert' || action === 'replace') {
        const intoIndex = findTopLevelToken(tokens, 'into', actionIndex + 1)
        return intoIndex >= 0 ? readTableAfter(tokens, intoIndex + 1, 0) : null
    }
    
    if (action === 'update') {
        return readTableAfter(tokens, actionIndex + 1, 0)
    }
    
    if (action === 'create' || action === 'alter' || action === 'drop' || action === 'truncate') {
        const tableIndex = findTopLevelToken(tokens, 'table', actionIndex + 1)
        return tableIndex >= 0 ? readTableAfter(tokens, tableIndex + 1, 0) : null
    }
    
    return null
}

function extractJoinedTables(tokens: SqlToken[], primaryTable: string | null): string[] {
    const joined = new Set<string>()
    
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        if (token.depth !== 0) continue
        if (token.lower !== 'join' && token.lower !== 'straight_join') continue
        
        const table = readTableAfter(tokens, i + 1, 0)
        if (!table) continue
        if (primaryTable && table === primaryTable) continue
        joined.add(table)
    }
    
    return Array.from(joined)
}

function findTopLevelToken(tokens: SqlToken[], value: string, start: number): number {
    return tokens.findIndex((token, index) => index >= start && token.depth === 0 && token.lower === value)
}

function readTableAfter(tokens: SqlToken[], start: number, depth: number): string | null {
    for (let i = start; i < tokens.length; i++) {
        const token = tokens[i]
        if (token.depth !== depth) continue
        if (token.value === '(') return null
        if (TABLE_SKIP_WORDS.has(token.lower)) continue
        return readIdentifier(tokens, i, depth)
    }
    
    return null
}

function readIdentifier(tokens: SqlToken[], start: number, depth: number): string | null {
    const first = cleanIdentifier(tokens[start]?.value)
    if (!first) return null
    
    const parts = [first]
    let i = start + 1
    
    while (tokens[i]?.depth === depth && tokens[i]?.value === '.' && tokens[i + 1]?.depth === depth) {
        const next = cleanIdentifier(tokens[i + 1].value)
        if (!next) break
        parts.push(next)
        i += 2
    }
    
    return parts.join('.')
}

function tokenizeSql(sql: string): SqlToken[] {
    const tokens: SqlToken[] = []
    let depth = 0
    let i = 0
    
    while (i < sql.length) {
        const char = sql[i]
        const next = sql[i + 1]
        
        if (/\s/.test(char)) {
            i++
            continue
        }
        
        if (char === '-' && next === '-') {
            i += 2
            while (i < sql.length && sql[i] !== '\n') i++
            continue
        }
        
        if (char === '/' && next === '*') {
            i += 2
            while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
            i += 2
            continue
        }
        
        if (char === '\'') {
            i = skipQuoted(sql, i, '\'')
            continue
        }
        
        if (char === '"' || char === '`') {
            const end = skipQuoted(sql, i, char)
            pushToken(tokens, sql.slice(i, end), depth)
            i = end
            continue
        }
        
        if (char === '[') {
            const end = skipBracketIdentifier(sql, i)
            pushToken(tokens, sql.slice(i, end), depth)
            i = end
            continue
        }
        
        if (char === '(') {
            pushToken(tokens, char, depth)
            depth++
            i++
            continue
        }
        
        if (char === ')') {
            depth = Math.max(0, depth - 1)
            pushToken(tokens, char, depth)
            i++
            continue
        }
        
        if (char === '.') {
            pushToken(tokens, char, depth)
            i++
            continue
        }
        
        if (/[A-Za-z0-9_$]/.test(char)) {
            const start = i
            i++
            while (i < sql.length && /[A-Za-z0-9_.$-]/.test(sql[i])) i++
            pushToken(tokens, sql.slice(start, i), depth)
            continue
        }
        
        i++
    }
    
    return tokens
}

function pushToken(tokens: SqlToken[], value: string, depth: number) {
    tokens.push({
        value,
        lower: cleanIdentifier(value)?.toLowerCase() ?? value.toLowerCase(),
        depth,
    })
}

function skipQuoted(sql: string, start: number, quote: string): number {
    let i = start + 1
    
    while (i < sql.length) {
        if (sql[i] === quote) {
            if (sql[i + 1] === quote) {
                i += 2
                continue
            }
            return i + 1
        }
        i++
    }
    
    return sql.length
}

function skipBracketIdentifier(sql: string, start: number): number {
    let i = start + 1
    while (i < sql.length && sql[i] !== ']') i++
    return Math.min(sql.length, i + 1)
}

function cleanIdentifier(value: string | null | undefined): string | null {
    if (!value) return null
    if (value === '(' || value === ')' || value === '.') return null
    
    const trimmed = value.trim()
    if (!trimmed) return null
    
    if (
        (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
        return trimmed.slice(1, -1) || null
    }
    
    return trimmed
}
