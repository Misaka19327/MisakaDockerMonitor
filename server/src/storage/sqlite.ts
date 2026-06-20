import {Database, type SQLQueryBindings} from 'bun:sqlite'
import {config, ensureDataDir} from '../config'
import {isSafeFieldName, nowISO} from '../utils'
import type {
    ContainerInstance,
    GroupResult,
    LogEntry,
    LogQueryParams,
    LogQueryResult,
    ParsedLogPatch,
    Service,
    StorageAdapter
} from './index'

export class SqliteStorage implements StorageAdapter {
    private db!: Database
    private insertStmt: any = null

    async initialize(): Promise<void> {
        ensureDataDir()
        this.db = new Database(config.sqlite.path)
        this.db.run(`PRAGMA journal_mode = ${config.sqlite.journalMode}`)
        this.db.run(`PRAGMA synchronous = ${config.sqlite.synchronous}`)
        this.db.run('PRAGMA busy_timeout = 5000')
        this.db.run('PRAGMA wal_autocheckpoint = 1000')
        this.createTables()
    }

    // --- Services ---

    async getOrCreateService(serviceKey: string, project: string | null, service: string | null, displayName: string): Promise<string> {
        const existing = this.db.query(`SELECT uuid FROM services WHERE service_key = ?`).get(serviceKey) as {
            uuid: string
        } | null
        if (existing) return existing.uuid

        const uuid = crypto.randomUUID()
        this.db.run(
            `INSERT INTO services (uuid, service_key, project, service, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [uuid, serviceKey, project, service, displayName, nowISO()],
        )
        return uuid
    }

    async getServiceByUuid(uuid: string): Promise<Service | null> {
        const row = this.db.query(`SELECT * FROM services WHERE uuid = ?`).get(uuid) as any
        if (!row) return null
        return this.rowToService(row)
    }

    async getActiveContainerId(serviceUuid: string): Promise<string | null> {
        const row = this.db.query(
            `SELECT container_id FROM container_instances WHERE service_uuid = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
        ).get(serviceUuid) as { container_id: string } | null
        return row?.container_id ?? null
    }

    async setServiceComposePath(serviceUuid: string, composePath: string | null): Promise<void> {
        this.db.run(
            `UPDATE services
             SET compose_path = ?
             WHERE uuid = ?`,
            [composePath, serviceUuid],
        )
    }

    async setServiceEnvEditLock(serviceUuid: string, locked: boolean, reason: string | null = null): Promise<void> {
        this.db.run(
            `UPDATE services
             SET env_edit_locked = ?,
                 env_edit_lock_reason = ?,
                 env_edit_locked_at = ?
             WHERE uuid = ?`,
            [locked ? 1 : 0, reason, locked ? nowISO() : null, serviceUuid],
        )
    }

    async clearServiceEnvEditLocks(): Promise<void> {
        this.db.run(
            `UPDATE services
             SET env_edit_locked = 0,
                 env_edit_lock_reason = NULL,
                 env_edit_locked_at = NULL
             WHERE env_edit_locked != 0`,
        )
    }

    // --- Logs ---

    async insertLog(entry: LogEntry): Promise<void> {
        if (!this.insertStmt) {
            this.insertStmt = this.db.prepare(
                `INSERT INTO log_entries (service_uuid, container_id, container_name, instance_id, timestamp, line_number,
                                          raw_content, is_json, parsed_json, level, content, has_sql, sql, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
        }
        const result = this.insertStmt.run(
            entry.serviceUuid, entry.containerId, entry.containerName, entry.instanceId, entry.timestamp,
            entry.lineNumber, entry.rawContent, entry.isJson ? 1 : 0, entry.parsedJson,
            entry.level, entry.content, entry.hasSql ? 1 : 0, entry.sql, entry.createdAt,
        )
        entry.id = Number(result.lastInsertRowid)
    }

    async insertLogs(entries: LogEntry[]): Promise<void> {
        const stmt = this.db.prepare(
            `INSERT INTO log_entries (service_uuid, container_id, container_name, instance_id, timestamp, line_number,
                                      raw_content, is_json, parsed_json, level, content, has_sql, sql, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )

        const tx = this.db.transaction((items: LogEntry[]) => {
            for (const entry of items) {
                const result = stmt.run(
                    entry.serviceUuid, entry.containerId, entry.containerName, entry.instanceId, entry.timestamp,
                    entry.lineNumber, entry.rawContent, entry.isJson ? 1 : 0, entry.parsedJson,
                    entry.level, entry.content, entry.hasSql ? 1 : 0, entry.sql, entry.createdAt,
                )
                entry.id = Number(result.lastInsertRowid)
            }
        })

        tx(entries)
    }

    async backfillParsedLogs(entries: ParsedLogPatch[]): Promise<void> {
        if (entries.length === 0) return

        const stmt = this.db.prepare(`
            UPDATE log_entries
            SET timestamp = ?,
                is_json = ?,
                parsed_json = ?,
                level = ?,
                content = ?,
                has_sql = ?,
                sql = ?
            WHERE id = ?
        `)

        const tx = this.db.transaction((items: ParsedLogPatch[]) => {
            for (const entry of items) {
                stmt.run(
                    entry.timestamp,
                    entry.isJson ? 1 : 0,
                    entry.parsedJson,
                    entry.level,
                    entry.content,
                    entry.hasSql ? 1 : 0,
                    entry.sql,
                    entry.id,
                )
            }
        })

        tx(entries)
    }

    async queryLogs(params: LogQueryParams): Promise<LogQueryResult> {
        const {
            serviceUuid,
            instanceId,
            search,
            level,
            startTime,
            endTime,
            field,
            fieldValue,
            limit = 200,
            offset = 0
        } = params

        const conditions: string[] = []
        const values: SQLQueryBindings[] = []

        if (instanceId) {
            conditions.push('instance_id = ?')
            values.push(instanceId)
        } else {
            conditions.push('service_uuid = ?')
            values.push(serviceUuid)
        }
        if (search) {
            conditions.push('(content LIKE ? OR raw_content LIKE ?)')
            values.push(`%${search}%`, `%${search}%`)
        }
        if (level) {
            conditions.push('level = ?')
            values.push(level)
        }
        if (startTime) {
            conditions.push('timestamp >= ?')
            values.push(startTime)
        }
        if (endTime) {
            conditions.push('timestamp <= ?')
            values.push(endTime)
        }
        if (field && fieldValue && field !== 'level') {
            conditions.push('parsed_json LIKE ?')
            values.push(`%"${field}":"${fieldValue}"%`)
        }

        const where = conditions.join(' AND ')

        const countRow = this.db.query(`SELECT COUNT(*) as total FROM log_entries WHERE ${where}`).get(...values) as {
            total: number
        } | null
        const total = countRow?.total ?? 0

        const rows = this.db.query(`
            SELECT * FROM (
                SELECT * FROM log_entries WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?
            ) ORDER BY id ASC
        `).all(...values, limit, offset) as any[]

        return {entries: rows.map(r => this.rowToEntry(r)), total, hasMore: offset + limit < total}
    }

    async groupByField(serviceUuid: string, field: string, instanceId?: string): Promise<GroupResult> {
        this.validateField(field)
        let queryStr: string
        let values: SQLQueryBindings[]

        if (field === 'level') {
            queryStr = `SELECT level as value, COUNT(*) as count FROM log_entries WHERE service_uuid = ? AND level IS NOT NULL`
            values = [serviceUuid]
            if (instanceId) {
                queryStr += ' AND instance_id = ?'
                values.push(instanceId)
            }
            queryStr += ' GROUP BY level ORDER BY count DESC LIMIT 100'
        } else {
            queryStr = `SELECT json_extract(parsed_json, '$.${field}') as value, COUNT(*) as count FROM log_entries WHERE service_uuid = ? AND is_json = 1 AND json_extract(parsed_json, '$.${field}') IS NOT NULL`
            values = [serviceUuid]
            if (instanceId) {
                queryStr += ' AND instance_id = ?'
                values.push(instanceId)
            }
            queryStr += ` GROUP BY value ORDER BY count DESC LIMIT 100`
        }

        const rows = this.db.query(queryStr).all(...values) as { value: string; count: number }[]
        return {field, groups: rows}
    }

    async getDistinctLevels(serviceUuid: string): Promise<string[]> {
        const rows = this.db.query(
            `SELECT DISTINCT level
             FROM log_entries
             WHERE service_uuid = ?
               AND level IS NOT NULL
             ORDER BY level`,
        ).all(serviceUuid) as { level: string }[]
        return rows.map(r => r.level)
    }

    async getDistinctFieldValues(serviceUuid: string, field: string): Promise<string[]> {
        this.validateField(field)
        const rows = this.db.query(
            `SELECT DISTINCT json_extract(parsed_json, '$.${field}') as val FROM log_entries
             WHERE service_uuid = ?
               AND is_json = 1
               AND json_extract(parsed_json, '$.${field}') IS NOT NULL
             ORDER BY val
             LIMIT 100`,
        ).all(serviceUuid) as { val: string }[]
        return rows.map(r => r.val)
    }

    async deleteLogsByInstance(instanceId: string): Promise<void> {
        this.db.run('DELETE FROM log_entries WHERE instance_id = ?', [instanceId])
        this.db.run('DELETE FROM container_instances WHERE id = ?', [instanceId])
    }

    async deleteLogsByService(serviceUuid: string): Promise<void> {
        this.db.run('DELETE FROM log_entries WHERE service_uuid = ?', [serviceUuid])
        this.db.run('DELETE FROM container_instances WHERE service_uuid = ?', [serviceUuid])
    }

    async deleteLogsBefore(cutoff: string): Promise<number> {
        const result = this.db.run('DELETE FROM log_entries WHERE created_at < ?', [cutoff])
        return result.changes
    }

    // --- Instances ---

    async createInstance(containerId: string, containerName: string, serviceUuid: string): Promise<string> {
        const id = `inst_${containerId}_${Date.now()}`
        this.db.run(
            `INSERT INTO container_instances (id, service_uuid, container_id, container_name, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')`,
            [id, serviceUuid, containerId, containerName, nowISO()],
        )
        return id
    }

    async stopInstance(instanceId: string): Promise<void> {
        this.db.run(
            `UPDATE container_instances SET stopped_at = ?, status = 'stopped' WHERE id = ?`,
            [nowISO(), instanceId],
        )
    }

    async getInstances(serviceUuid: string): Promise<ContainerInstance[]> {
        const rows = this.db.query(
            `SELECT * FROM container_instances WHERE service_uuid = ? ORDER BY started_at DESC`,
        ).all(serviceUuid) as any[]
        return rows.map(r => this.rowToInstance(r))
    }

    async getActiveInstance(serviceUuid: string): Promise<ContainerInstance | null> {
        const row = this.db.query(
            `SELECT * FROM container_instances WHERE service_uuid = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
        ).get(serviceUuid) as any
        if (!row) return null
        return this.rowToInstance(row)
    }

    async isContainerWatched(serviceUuid: string): Promise<boolean> {
        const row = this.db.query(
            `SELECT watched FROM container_instances WHERE service_uuid = ? ORDER BY started_at DESC LIMIT 1`,
        ).get(serviceUuid) as { watched: number } | null
        return row ? row.watched === 1 : false
    }

    async setContainerWatched(serviceUuid: string, watched: boolean): Promise<void> {
        this.db.run(
            `UPDATE container_instances SET watched = ? WHERE service_uuid = ?`,
            [watched ? 1 : 0, serviceUuid],
        )
    }

    async deleteStoppedInstancesWithNoLogs(): Promise<number> {
        const result = this.db.run(`
            DELETE FROM container_instances
            WHERE status = 'stopped'
            AND id NOT IN (SELECT DISTINCT instance_id FROM log_entries WHERE instance_id IS NOT NULL)
        `)
        return result.changes
    }

    async checkpoint(): Promise<void> {
        this.db.run('PRAGMA wal_checkpoint(TRUNCATE)')
    }

    async vacuum(): Promise<void> {
        this.db.run('VACUUM')
    }

    async close(): Promise<void> {
        this.db.close()
    }

    // --- Private ---

    private createTables() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS services (
                uuid TEXT PRIMARY KEY,
                service_key TEXT NOT NULL UNIQUE,
                project TEXT,
                service TEXT,
                display_name TEXT NOT NULL,
                compose_path TEXT,
                env_edit_locked INTEGER NOT NULL DEFAULT 0,
                env_edit_lock_reason TEXT,
                env_edit_locked_at TEXT,
                created_at TEXT NOT NULL
            )
        `)
        this.ensureColumn('services', 'compose_path', 'TEXT')
        this.ensureColumn('services', 'env_edit_locked', 'INTEGER NOT NULL DEFAULT 0')
        this.ensureColumn('services', 'env_edit_lock_reason', 'TEXT')
        this.ensureColumn('services', 'env_edit_locked_at', 'TEXT')

        this.db.run(`
            CREATE TABLE IF NOT EXISTS container_instances (
                id TEXT PRIMARY KEY,
                service_uuid TEXT NOT NULL,
                container_id TEXT NOT NULL,
                container_name TEXT NOT NULL,
                started_at TEXT NOT NULL,
                stopped_at TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                watched INTEGER NOT NULL DEFAULT 1
            )
        `)

        this.db.run(`
            CREATE TABLE IF NOT EXISTS log_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_uuid TEXT NOT NULL,
                container_id TEXT NOT NULL,
                container_name TEXT NOT NULL,
                instance_id TEXT NOT NULL,
                timestamp TEXT,
                line_number INTEGER NOT NULL,
                raw_content TEXT NOT NULL,
                is_json INTEGER NOT NULL DEFAULT 0,
                parsed_json TEXT,
                level TEXT,
                content TEXT NOT NULL,
                has_sql INTEGER NOT NULL DEFAULT 0,
                sql TEXT,
                created_at TEXT NOT NULL
            )
        `)

        this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_service ON log_entries(service_uuid)')
        this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_instance ON log_entries(instance_id)')
        this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_level ON log_entries(level)')
        this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON log_entries(timestamp)')
        this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_created_at ON log_entries(created_at)')
        this.db.run('CREATE INDEX IF NOT EXISTS idx_instances_service ON container_instances(service_uuid)')
    }

    private validateField(field: string): void {
        if (!isSafeFieldName(field)) throw new Error(`Invalid field name: ${field}`)
    }

    private rowToService(row: any): Service {
        return {
            uuid: row.uuid, serviceKey: row.service_key, project: row.project,
            service: row.service, displayName: row.display_name, composePath: row.compose_path ?? null,
            envEditLocked: row.env_edit_locked === 1,
            envEditLockReason: row.env_edit_lock_reason ?? null,
            envEditLockedAt: row.env_edit_locked_at ?? null,
            createdAt: row.created_at,
        }
    }

    private ensureColumn(table: string, column: string, definition: string): void {
        const columns = this.db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
        if (columns.some(c => c.name === column)) return
        this.db.run(`ALTER TABLE ${table}
            ADD COLUMN ${column} ${definition}`)
    }

    private rowToInstance(row: any): ContainerInstance {
        return {
            id: row.id, serviceUuid: row.service_uuid, containerId: row.container_id,
            containerName: row.container_name, startedAt: row.started_at,
            stoppedAt: row.stopped_at, status: row.status,
        }
    }

    private rowToEntry(row: any): LogEntry {
        return {
            id: row.id, serviceUuid: row.service_uuid, containerId: row.container_id,
            containerName: row.container_name, instanceId: row.instance_id,
            timestamp: row.timestamp, lineNumber: row.line_number, rawContent: row.raw_content,
            isJson: row.is_json === 1, parsedJson: row.parsed_json, level: row.level,
            content: row.content, hasSql: row.has_sql === 1, sql: row.sql, createdAt: row.created_at,
        }
    }
}
