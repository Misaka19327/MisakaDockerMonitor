import {useMemo} from 'react'
import {format as sqlFormat} from 'sql-formatter'

export function SqlView({sql}: { sql: string }) {
    const formatted = useMemo(() => {
        try {
            return sqlFormat(sql, {
                language: 'sql',
                tabWidth: 2,
                keywordCase: 'upper',
                linesBetweenQueries: 2,
            })
        } catch {
            return sql
        }
    }, [sql])
    
    return (
        <div className="border rounded-md bg-amber-50/50 overflow-hidden">
            <div className="px-3 py-1 bg-amber-100/50 border-b text-xs font-medium text-amber-800">
                SQL
            </div>
            <pre className="sql-formatted p-3 overflow-x-auto max-h-64 overflow-y-auto">
        {highlightSql(formatted)}
      </pre>
        </div>
    )
}

function highlightSql(sql: string): React.ReactNode {
    const keywords = /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|IS|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|DISTINCT|COUNT|SUM|AVG|MIN|MAX|BETWEEN|LIKE|EXISTS|UNION|ALL|CASE|WHEN|THEN|ELSE|END|DESC|ASC|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|UNIQUE|DEFAULT|AUTO_INCREMENT|VARCHAR|INT|BIGINT|TEXT|BOOLEAN|DATE|DATETIME|TIMESTAMP|FLOAT|DOUBLE|DECIMAL|CHAR|BLOB|CLOB|RETURNING|WITH|RECURSIVE)\b/gi
    
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    let key = 0
    
    const regex = new RegExp(keywords.source, keywords.flags)
    
    while ((match = regex.exec(sql)) !== null) {
        if (match.index > lastIndex) {
            parts.push(sql.substring(lastIndex, match.index))
        }
        parts.push(
            <span key={key++} className="sql-keyword">{match[0]}</span>
        )
        lastIndex = match.index + match[0].length
    }
    
    if (lastIndex < sql.length) {
        parts.push(sql.substring(lastIndex))
    }
    
    return parts
}
