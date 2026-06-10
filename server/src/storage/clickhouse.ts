import {createClient} from '@clickhouse/client'
import {config} from '../config'
import type {
    ContainerInstance,
    GroupResult,
    LogEntry,
    ParsedLogPatch,
    LogQueryParams,
    LogQueryResult,
    Service,
    StorageAdapter
} from './index'
import {assertSafeFieldName, escapeClickHouseString, nowISO} from '../utils'

export class ClickHouseStorage implements StorageAdapter {
    private client!: any

    async initialize(): Promise<void> {
        this.client = createClient({
            host: config.clickhouse.host,
            database: config.clickhouse.database,
            username: config.clickhouse.user,
            password: config.clickhouse.password,
        })
        await this.createTables()
    }
    
    // --- Services ---
    
    async getOrCreateService(serviceKey: string, project: string | null, service: string | null, displayName: string): Promise<string> {
        const escapedKey = escapeClickHouseString(serviceKey)
        const result = await this.client.query({
            query: `SELECT uuid
                    FROM services
                    WHERE service_key = '${escapedKey}' LIMIT 1`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        if (rows.length > 0) return (rows[0] as any).uuid
        
        const uuid = crypto.randomUUID()
        await this.client.insert({
            table: 'services',
            values: [{
                uuid,
                service_key: serviceKey,
                project,
                service,
                display_name: displayName,
                created_at: nowISO().replace('T', ' ').substring(0, 19)
            }],
            format: 'JSONEachRow',
        })
        return uuid
    }
    
    async getServiceByUuid(uuid: string): Promise<Service | null> {
        const result = await this.client.query({
            query: `SELECT *
                    FROM services
                    WHERE uuid = '${escapeClickHouseString(uuid)}' LIMIT 1`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        if (rows.length === 0) return null
        return this.rowToService(rows[0])
    }
    
    async getActiveContainerId(serviceUuid: string): Promise<string | null> {
        const result = await this.client.query({
            query: `SELECT container_id
                    FROM container_instances
                    WHERE service_uuid = '${escapeClickHouseString(serviceUuid)}'
                      AND status = 'running'
                    ORDER BY started_at DESC LIMIT 1`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        return rows[0]?.container_id ?? null
    }
    
    // --- Logs ---

    async insertLog(entry: LogEntry): Promise<void> {
        await this.insertLogs([entry])
    }

    async insertLogs(entries: LogEntry[]): Promise<void> {
        if (entries.length === 0) return
        const baseId = Date.now() * 1000
        const rows = entries.map((entry, index) => {
            const id = entry.id || (baseId + index)
            entry.id = id
            return {
                id,
            service_uuid: entry.serviceUuid,
            container_id: entry.containerId,
            container_name: entry.containerName,
            instance_id: entry.instanceId,
            timestamp: entry.timestamp,
            line_number: entry.lineNumber,
            raw_content: entry.rawContent,
            is_json: entry.isJson ? 1 : 0,
            parsed_json: entry.parsedJson,
            level: entry.level,
            content: entry.content,
            has_sql: entry.hasSql ? 1 : 0,
            sql: entry.sql,
            created_at: entry.createdAt.replace('T', ' ').substring(0, 19),
            }
        })
        await this.client.insert({table: 'log_entries', values: rows, format: 'JSONEachRow'})
    }

    async backfillParsedLogs(entries: ParsedLogPatch[]): Promise<void> {
        if (entries.length === 0) return

        for (const entry of entries) {
            await this.client.exec({
                query: `ALTER TABLE log_entries UPDATE
                    timestamp = ${entry.timestamp ? `'${escapeClickHouseString(entry.timestamp)}'` : 'NULL'},
                    is_json = ${entry.isJson ? 1 : 0},
                    parsed_json = ${entry.parsedJson ? `'${escapeClickHouseString(entry.parsedJson)}'` : 'NULL'},
                    level = ${entry.level ? `'${escapeClickHouseString(entry.level)}'` : 'NULL'},
                    content = '${escapeClickHouseString(entry.content)}',
                    has_sql = ${entry.hasSql ? 1 : 0},
                    sql = ${entry.sql ? `'${escapeClickHouseString(entry.sql)}'` : 'NULL'}
                 WHERE id = ${entry.id}`,
            })
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
        if (instanceId) {
            conditions.push(`instance_id = '${escapeClickHouseString(instanceId)}'`)
        } else {
            conditions.push(`service_uuid = '${escapeClickHouseString(serviceUuid)}'`)
        }
        if (search) {
            const escapedSearch = escapeClickHouseString(search)
            conditions.push(`(content LIKE '%${escapedSearch}%' OR raw_content LIKE '%${escapedSearch}%')`)
        }
        if (level) conditions.push(`level = '${escapeClickHouseString(level)}'`)
        if (startTime) conditions.push(`timestamp >= '${escapeClickHouseString(startTime)}'`)
        if (endTime) conditions.push(`timestamp <= '${escapeClickHouseString(endTime)}'`)
        if (field && fieldValue && field !== 'level') {
            const safeField = assertSafeFieldName(field)
            conditions.push(`JSONExtractString(parsed_json, '${safeField}') = '${escapeClickHouseString(fieldValue)}'`)
        }

        const where = conditions.join(' AND ')
        const countResult = await this.client.query({
            query: `SELECT COUNT(*) as total FROM log_entries WHERE ${where}`,
            format: 'JSONEachRow',
        })
        const countRows = await countResult.json()
        const total = countRows[0]?.total ?? 0

        const result = await this.client.query({
            query: `SELECT * FROM log_entries WHERE ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        return {entries: rows.map((r: any) => this.rowToEntry(r)), total, hasMore: offset + limit < total}
    }
    
    async groupByField(serviceUuid: string, field: string, instanceId?: string): Promise<GroupResult> {
        const safeField = assertSafeFieldName(field)
        const conditions = [`service_uuid = '${escapeClickHouseString(serviceUuid)}'`]
        if (instanceId) conditions.push(`instance_id = '${escapeClickHouseString(instanceId)}'`)
        const where = conditions.join(' AND ')

        let query: string
        if (safeField === 'level') {
            query = `SELECT level as value, COUNT(*) as count FROM log_entries WHERE ${where} AND level IS NOT NULL GROUP BY level ORDER BY count DESC LIMIT 100`
        } else {
            query = `SELECT JSONExtractString(parsed_json, '${safeField}') as value, COUNT(*) as count FROM log_entries WHERE ${where} AND is_json = 1 AND JSONExtractString(parsed_json, '${safeField}') != '' GROUP BY value ORDER BY count DESC LIMIT 100`
        }

        const result = await this.client.query({query, format: 'JSONEachRow'})
        const rows = await result.json()
        return {field: safeField, groups: rows}
    }
    
    async getDistinctLevels(serviceUuid: string): Promise<string[]> {
        const result = await this.client.query({
            query: `SELECT DISTINCT level
                    FROM log_entries
                    WHERE service_uuid = '${escapeClickHouseString(serviceUuid)}'
                      AND level IS NOT NULL
                    ORDER BY level`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        return rows.map((r: any) => r.level)
    }
    
    async getDistinctFieldValues(serviceUuid: string, field: string): Promise<string[]> {
        const safeField = assertSafeFieldName(field)
        const result = await this.client.query({
            query: `SELECT DISTINCT JSONExtractString(parsed_json, '${safeField}') as val FROM log_entries WHERE service_uuid = '${escapeClickHouseString(serviceUuid)}' AND is_json = 1 ORDER BY val LIMIT 100`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        return rows.map((r: any) => r.val)
    }
    
    async deleteLogsByInstance(instanceId: string): Promise<void> {
        const escapedId = escapeClickHouseString(instanceId)
        await this.client.exec({query: `ALTER TABLE log_entries DELETE WHERE instance_id = '${escapedId}'`})
        await this.client.exec({query: `ALTER TABLE container_instances DELETE WHERE id = '${escapedId}'`})
    }
    
    async deleteLogsByService(serviceUuid: string): Promise<void> {
        const escapedUuid = escapeClickHouseString(serviceUuid)
        await this.client.exec({query: `ALTER TABLE log_entries DELETE WHERE service_uuid = '${escapedUuid}'`})
        await this.client.exec({query: `ALTER TABLE container_instances DELETE WHERE service_uuid = '${escapedUuid}'`})
    }
    
    async deleteLogsBefore(cutoff: string): Promise<number> {
        await this.client.exec({query: `ALTER TABLE log_entries DELETE WHERE created_at < '${escapeClickHouseString(cutoff)}'`})
        return 0
    }
    
    // --- Instances ---
    
    async createInstance(containerId: string, containerName: string, serviceUuid: string): Promise<string> {
        const id = `inst_${containerId}_${Date.now()}`
        await this.client.insert({
            table: 'container_instances',
            values: [{
                id,
                service_uuid: serviceUuid,
                container_id: containerId,
                container_name: containerName,
                started_at: nowISO().replace('T', ' ').substring(0, 19),
                stopped_at: null,
                status: 'running'
            }],
            format: 'JSONEachRow',
        })
        return id
    }

    async stopInstance(instanceId: string): Promise<void> {
        const stoppedAt = nowISO().replace('T', ' ').substring(0, 19)
        await this.client.exec({
            query: `ALTER TABLE container_instances UPDATE stopped_at = '${stoppedAt}', status = 'stopped' WHERE id = '${escapeClickHouseString(instanceId)}'`,
        })
    }
    
    async getInstances(serviceUuid: string): Promise<ContainerInstance[]> {
        const result = await this.client.query({
            query: `SELECT * FROM container_instances WHERE service_uuid = '${escapeClickHouseString(serviceUuid)}' ORDER BY started_at DESC`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        return rows.map((r: any) => this.rowToInstance(r))
    }
    
    async getActiveInstance(serviceUuid: string): Promise<ContainerInstance | null> {
        const result = await this.client.query({
            query: `SELECT *
                    FROM container_instances
                    WHERE service_uuid = '${escapeClickHouseString(serviceUuid)}'
                      AND status = 'running'
                    ORDER BY started_at DESC LIMIT 1`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        if (!rows[0]) return null
        return this.rowToInstance(rows[0])
    }
    
    async isContainerWatched(serviceUuid: string): Promise<boolean> {
        const result = await this.client.query({
            query: `SELECT watched FROM container_instances WHERE service_uuid = '${escapeClickHouseString(serviceUuid)}' ORDER BY started_at DESC LIMIT 1`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        if (!rows[0]) return false
        return (rows[0] as any).watched === 1
    }
    
    async setContainerWatched(serviceUuid: string, watched: boolean): Promise<void> {
        await this.client.exec({
            query: `ALTER TABLE container_instances UPDATE watched = ${watched ? 1 : 0} WHERE service_uuid = '${escapeClickHouseString(serviceUuid)}'`,
        })
    }

    async deleteStoppedInstancesWithNoLogs(): Promise<number> {
        const result = await this.client.query({
            query: `SELECT ci.id FROM container_instances ci LEFT ANTI JOIN log_entries le ON ci.id = le.instance_id WHERE ci.status = 'stopped'`,
            format: 'JSONEachRow',
        })
        const rows = await result.json() as any[]
        for (const row of rows) {
            await this.client.exec({query: `ALTER TABLE container_instances DELETE WHERE id = '${escapeClickHouseString(row.id)}'`})
        }
        return rows.length
    }
    
    async close(): Promise<void> {
        await this.client.close()
    }
    
    async checkpoint(): Promise<void> {
    }
    
    async vacuum(): Promise<void> {
    }
    
    // --- Private ---

    private async createTables() {
        await this.client.exec({query: `CREATE DATABASE IF NOT EXISTS ${config.clickhouse.database}`})

        await this.client.exec({
            query: `CREATE TABLE IF NOT EXISTS services (
                uuid String,
                service_key String,
                project Nullable(String),
                service Nullable(String),
                display_name String,
                created_at DateTime
            ) ENGINE = MergeTree() ORDER BY (service_key)`,
        })
        
        await this.client.exec({
            query: `CREATE TABLE IF NOT EXISTS container_instances (
                id String,
                service_uuid String,
                container_id String,
                container_name String,
                started_at DateTime,
                stopped_at Nullable(DateTime),
                status String,
                watched UInt8 DEFAULT 1
            ) ENGINE = MergeTree() ORDER BY (service_uuid, started_at)`,
        })
        
        await this.client.exec({
            query: `CREATE TABLE IF NOT EXISTS log_entries (
                id UInt64,
                service_uuid String,
                container_id String,
                container_name String,
                instance_id String,
                timestamp Nullable(String),
                line_number UInt32,
                raw_content String,
                is_json UInt8,
                parsed_json Nullable(String),
                level Nullable(String),
                content String,
                has_sql UInt8,
                sql Nullable(String),
                created_at DateTime
            ) ENGINE = MergeTree() ORDER BY (service_uuid, instance_id, id)`,
        })
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
            id: Number(row.id), serviceUuid: row.service_uuid, containerId: row.container_id,
            containerName: row.container_name, instanceId: row.instance_id,
            timestamp: row.timestamp, lineNumber: row.line_number, rawContent: row.raw_content,
            isJson: row.is_json === 1, parsedJson: row.parsed_json, level: row.level,
            content: row.content, hasSql: row.has_sql === 1, sql: row.sql, createdAt: row.created_at,
        }
    }
}
