import mysql from 'mysql2/promise'
import {config} from '../config'
import {isSafeFieldName, nowISO} from '../utils'
import type {
    ContainerInstance,
    GroupResult,
    LogEntry,
    LogQueryParams,
    LogQueryResult,
    Service,
    StorageAdapter
} from './index'

export class MysqlStorage implements StorageAdapter {
    private pool!: mysql.Pool

    async initialize(): Promise<void> {
        this.pool = mysql.createPool({
            host: config.mysql.host,
            port: config.mysql.port,
            user: config.mysql.user,
            password: config.mysql.password,
            database: config.mysql.database,
            waitForConnections: true,
            connectionLimit: 10,
        })
        await this.createTables()
    }
    
    // --- Services ---
    
    async getOrCreateService(serviceKey: string, project: string | null, service: string | null, displayName: string): Promise<string> {
        const [existing] = await this.pool.execute(`SELECT uuid
                                                    FROM services
                                                    WHERE service_key = ?`, [serviceKey]) as any
        if (existing[0]) return existing[0].uuid
        
        const uuid = crypto.randomUUID()
        try {
            await this.pool.execute(
                `INSERT INTO services (uuid, service_key, project, service, display_name, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [uuid, serviceKey, project, service, displayName, nowISO()],
            )
        } catch (e: any) {
            if (e.code === 'ER_DUP_ENTRY') {
                const [row] = await this.pool.execute(`SELECT uuid
                                                       FROM services
                                                       WHERE service_key = ?`, [serviceKey]) as any
                return row[0].uuid
            }
            throw e
        }
        return uuid
    }
    
    async getServiceByUuid(uuid: string): Promise<Service | null> {
        const [rows] = await this.pool.execute(`SELECT *
                                                FROM services
                                                WHERE uuid = ?`, [uuid]) as any
        const row = rows[0]
        if (!row) return null
        return this.rowToService(row)
    }
    
    async getActiveContainerId(serviceUuid: string): Promise<string | null> {
        const [rows] = await this.pool.execute(
            `SELECT container_id
             FROM container_instances
             WHERE service_uuid = ?
               AND status = 'running'
             ORDER BY started_at DESC
             LIMIT 1`,
            [serviceUuid],
        ) as any
        return rows[0]?.container_id ?? null
    }
    
    // --- Logs ---

    async insertLog(entry: LogEntry): Promise<void> {
        const [result] = await this.pool.execute(
            `INSERT INTO log_entries (service_uuid, container_id, container_name, instance_id, timestamp, line_number,
                                      raw_content, is_json, parsed_json, level, content, has_sql, sql_text, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [entry.serviceUuid, entry.containerId, entry.containerName, entry.instanceId, entry.timestamp,
                entry.lineNumber, entry.rawContent, entry.isJson ? 1 : 0, entry.parsedJson,
                entry.level, entry.content, entry.hasSql ? 1 : 0, entry.sql, entry.createdAt],
        ) as any
        entry.id = Number(result.insertId)
    }

    async insertLogs(entries: LogEntry[]): Promise<void> {
        const conn = await this.pool.getConnection()
        try {
            await conn.beginTransaction()
            for (const entry of entries) {
                const [result] = await conn.execute(
                    `INSERT INTO log_entries (service_uuid, container_id, container_name, instance_id, timestamp,
                                              line_number,
                                              raw_content, is_json, parsed_json, level, content, has_sql, sql_text,
                                              created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [entry.serviceUuid, entry.containerId, entry.containerName, entry.instanceId, entry.timestamp,
                        entry.lineNumber, entry.rawContent, entry.isJson ? 1 : 0, entry.parsedJson,
                        entry.level, entry.content, entry.hasSql ? 1 : 0, entry.sql, entry.createdAt],
                ) as any
                entry.id = Number(result.insertId)
            }
            await conn.commit()
        } catch (e) {
            await conn.rollback()
            throw e
        } finally {
            conn.release()
        }
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
        const values: any[] = []

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
            conditions.push('JSON_EXTRACT(parsed_json, ?) = ?')
            values.push(`$.${field}`, fieldValue)
        }

        const where = conditions.join(' AND ')

        const [countRows] = await this.pool.execute(`SELECT COUNT(*) as total FROM log_entries WHERE ${where}`, values) as any
        const total = countRows[0]?.total ?? 0

        const [rows] = await this.pool.execute(
            `SELECT * FROM (SELECT * FROM log_entries WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?) AS sub ORDER BY id ASC`,
            [...values, String(limit), String(offset)],
        ) as any
        
        return {entries: (rows as any[]).map(r => this.rowToEntry(r)), total, hasMore: offset + limit < total}
    }
    
    async groupByField(serviceUuid: string, field: string, instanceId?: string): Promise<GroupResult> {
        if (!isSafeFieldName(field)) throw new Error(`Invalid field name: ${field}`)

        if (field === 'level') {
            const conditions = ['service_uuid = ?', 'level IS NOT NULL']
            const values: any[] = [serviceUuid]
            if (instanceId) {
                conditions.push('instance_id = ?');
                values.push(instanceId)
            }
            const [rows] = await this.pool.execute(
                `SELECT level as value, COUNT(*) as count
                 FROM log_entries
                 WHERE ${conditions.join(' AND ')}
                 GROUP BY level
                 ORDER BY count DESC
                 LIMIT 100`, values,
            ) as any
            return {field, groups: rows}
        }
        
        const conditions = ['service_uuid = ?', 'is_json = 1', `JSON_EXTRACT(parsed_json, '$.${field}') IS NOT NULL`]
        const values: any[] = [serviceUuid]
        if (instanceId) {
            conditions.push('instance_id = ?');
            values.push(instanceId)
        }
        const [rows] = await this.pool.execute(
            `SELECT JSON_EXTRACT(parsed_json, '$.${field}') as value, COUNT(*) as count
             FROM log_entries
             WHERE ${conditions.join(' AND ')}
             GROUP BY value
             ORDER BY count DESC
             LIMIT 100`, values,
        ) as any
        return {field, groups: rows}
    }
    
    async getDistinctLevels(serviceUuid: string): Promise<string[]> {
        const [rows] = await this.pool.execute(`SELECT DISTINCT level
                                                FROM log_entries
                                                WHERE service_uuid = ?
                                                  AND level IS NOT NULL`, [serviceUuid]) as any
        return (rows as any[]).map(r => r.level)
    }
    
    async getDistinctFieldValues(serviceUuid: string, field: string): Promise<string[]> {
        if (!isSafeFieldName(field)) throw new Error(`Invalid field name: ${field}`)
        const [rows] = await this.pool.execute(
            `SELECT DISTINCT JSON_EXTRACT(parsed_json, '$.${field}') as val
             FROM log_entries
             WHERE service_uuid = ?
               AND is_json = 1
               AND JSON_EXTRACT(parsed_json, '$.${field}') IS NOT NULL
             LIMIT 100`,
            [serviceUuid],
        ) as any
        return (rows as any[]).map(r => r.val)
    }
    
    async deleteLogsByInstance(instanceId: string): Promise<void> {
        await this.pool.execute('DELETE FROM log_entries WHERE instance_id = ?', [instanceId])
        await this.pool.execute('DELETE FROM container_instances WHERE id = ?', [instanceId])
    }
    
    async deleteLogsByService(serviceUuid: string): Promise<void> {
        await this.pool.execute('DELETE FROM log_entries WHERE service_uuid = ?', [serviceUuid])
        await this.pool.execute('DELETE FROM container_instances WHERE service_uuid = ?', [serviceUuid])
    }
    
    async deleteLogsBefore(cutoff: string): Promise<number> {
        const [result] = await this.pool.execute('DELETE FROM log_entries WHERE created_at < ?', [cutoff]) as any
        return result.affectedRows
    }
    
    // --- Instances ---
    
    async createInstance(containerId: string, containerName: string, serviceUuid: string): Promise<string> {
        const id = `inst_${containerId}_${Date.now()}`
        await this.pool.execute(
            `INSERT INTO container_instances (id, service_uuid, container_id, container_name, started_at, status)
             VALUES (?, ?, ?, ?, ?, 'running')`,
            [id, serviceUuid, containerId, containerName, nowISO()],
        )
        return id
    }

    async stopInstance(instanceId: string): Promise<void> {
        await this.pool.execute(`UPDATE container_instances SET stopped_at = ?, status = 'stopped' WHERE id = ?`, [nowISO(), instanceId])
    }
    
    async getInstances(serviceUuid: string): Promise<ContainerInstance[]> {
        const [rows] = await this.pool.execute(
            `SELECT *
             FROM container_instances
             WHERE service_uuid = ?
             ORDER BY started_at DESC`, [serviceUuid],
        ) as any
        return (rows as any[]).map(r => this.rowToInstance(r))
    }
    
    async getActiveInstance(serviceUuid: string): Promise<ContainerInstance | null> {
        const [rows] = await this.pool.execute(
            `SELECT *
             FROM container_instances
             WHERE service_uuid = ?
               AND status = 'running'
             ORDER BY started_at DESC
             LIMIT 1`, [serviceUuid],
        ) as any
        const row = rows[0]
        if (!row) return null
        return this.rowToInstance(row)
    }
    
    async isContainerWatched(serviceUuid: string): Promise<boolean> {
        const [rows] = await this.pool.execute(
            `SELECT watched
             FROM container_instances
             WHERE service_uuid = ?
             ORDER BY started_at DESC
             LIMIT 1`, [serviceUuid],
        ) as any
        const row = rows[0]
        return row ? row.watched === 1 : true
    }
    
    async setContainerWatched(serviceUuid: string, watched: boolean): Promise<void> {
        await this.pool.execute(
            `UPDATE container_instances
             SET watched = ?
             WHERE service_uuid = ?`,
            [watched ? 1 : 0, serviceUuid],
        )
    }
    
    async deleteStoppedInstancesWithNoLogs(): Promise<number> {
        const [result] = await this.pool.execute(`
            DELETE ci
            FROM container_instances ci
                     LEFT JOIN log_entries le ON ci.id = le.instance_id
            WHERE ci.status = 'stopped'
              AND le.id IS NULL
        `) as any
        return result.affectedRows
    }
    
    async close(): Promise<void> {
        await this.pool.end()
    }
    
    async checkpoint(): Promise<void> {
    }
    
    async vacuum(): Promise<void> {
    }
    
    // --- Private ---

    private async createTables() {
        const conn = await this.pool.getConnection()
        try {
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS services
                (
                    uuid         VARCHAR(36) PRIMARY KEY,
                    service_key  VARCHAR(511) NOT NULL UNIQUE,
                    project      VARCHAR(255),
                    service      VARCHAR(255),
                    display_name VARCHAR(255) NOT NULL,
                    created_at   DATETIME     NOT NULL
                )
            `)

            await conn.execute(`
                CREATE TABLE IF NOT EXISTS container_instances
                (
                    id             VARCHAR(100) PRIMARY KEY,
                    service_uuid   VARCHAR(36)  NOT NULL,
                    container_id   VARCHAR(100) NOT NULL,
                    container_name VARCHAR(255) NOT NULL,
                    started_at     DATETIME     NOT NULL,
                    stopped_at     DATETIME     NULL,
                    status         VARCHAR(20)  NOT NULL DEFAULT 'running',
                    watched        TINYINT      NOT NULL DEFAULT 1,
                    INDEX idx_ci_service (service_uuid)
                )
            `)

            await conn.execute(`
                CREATE TABLE IF NOT EXISTS log_entries
                (
                    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
                    service_uuid   VARCHAR(36)  NOT NULL,
                    container_id   VARCHAR(100) NOT NULL,
                    container_name VARCHAR(255) NOT NULL,
                    instance_id    VARCHAR(100) NOT NULL,
                    timestamp      VARCHAR(100) NULL,
                    line_number    INT          NOT NULL,
                    raw_content    TEXT         NOT NULL,
                    is_json        TINYINT      NOT NULL DEFAULT 0,
                    parsed_json    JSON         NULL,
                    level          VARCHAR(50)  NULL,
                    content        TEXT         NOT NULL,
                    has_sql        TINYINT      NOT NULL DEFAULT 0,
                    sql_text       MEDIUMTEXT   NULL,
                    created_at     DATETIME     NOT NULL,
                    INDEX idx_le_service (service_uuid),
                    INDEX idx_le_instance (instance_id),
                    INDEX idx_le_level (level),
                    INDEX idx_le_timestamp (timestamp),
                    INDEX idx_le_created_at (created_at)
                )
            `)
        } finally {
            conn.release()
        }
    }
    
    private rowToService(row: any): Service {
        return {
            uuid: row.uuid, serviceKey: row.service_key, project: row.project,
            service: row.service, displayName: row.display_name, createdAt: row.created_at,
        }
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
            id: row.id,
            serviceUuid: row.service_uuid,
            containerId: row.container_id,
            containerName: row.container_name,
            instanceId: row.instance_id,
            timestamp: row.timestamp,
            lineNumber: row.line_number,
            rawContent: row.raw_content,
            isJson: row.is_json === 1,
            parsedJson: typeof row.parsed_json === 'object' ? JSON.stringify(row.parsed_json) : row.parsed_json,
            level: row.level,
            content: row.content,
            hasSql: row.has_sql === 1,
            sql: row.sql_text,
            createdAt: row.created_at,
        }
    }
}
