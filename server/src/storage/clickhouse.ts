import {createClient} from '@clickhouse/client'
import {config} from '../config'
import type {ContainerInstance, GroupResult, LogEntry, LogQueryParams, LogQueryResult, StorageAdapter} from './index'
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
    
    async insertLog(entry: LogEntry): Promise<void> {
        await this.insertLogs([entry])
    }
    
    async insertLogs(entries: LogEntry[]): Promise<void> {
        if (entries.length === 0) return
        
        const rows = entries.map(entry => ({
            id: entry.id || Date.now(),
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
            created_at: entry.createdAt,
        }))
        
        await this.client.insert({
            table: 'log_entries',
            values: rows,
            format: 'JSONEachRow',
        })
    }
    
    async queryLogs(params: LogQueryParams): Promise<LogQueryResult> {
        const {
            containerId,
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
            conditions.push(`container_id = '${escapeClickHouseString(containerId)}'`)
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
            query: `SELECT COUNT(*) as total
                    FROM log_entries
                    WHERE ${where}`,
            format: 'JSONEachRow',
        })
        const countRows = await countResult.json()
        const total = countRows[0]?.total ?? 0
        
        const result = await this.client.query({
            query: `SELECT *
                    FROM log_entries
                    WHERE ${where}
                    ORDER BY id DESC LIMIT ${limit}
                    OFFSET ${offset}`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        
        return {
            entries: rows.map((r: any) => this.rowToEntry(r)),
            total,
            hasMore: offset + limit < total,
        }
    }
    
    async groupByField(containerId: string, field: string, instanceId?: string): Promise<GroupResult> {
        const safeField = assertSafeFieldName(field)
        const conditions = [`container_id = '${escapeClickHouseString(containerId)}'`]
        if (instanceId) conditions.push(`instance_id = '${escapeClickHouseString(instanceId)}'`)
        const where = conditions.join(' AND ')
        
        let query: string
        if (safeField === 'level') {
            query = `SELECT level as value, COUNT(*) as count
                     FROM log_entries
                     WHERE ${where} AND level IS NOT NULL
                     GROUP BY level
                     ORDER BY count DESC LIMIT 100`
        } else {
            query = `SELECT JSONExtractString(parsed_json, '${safeField}') as value, COUNT(*) as count
                     FROM log_entries
                     WHERE ${where} AND is_json = 1 AND JSONExtractString(parsed_json, '${safeField}') != ''
                     GROUP BY value
                     ORDER BY count DESC LIMIT 100`
        }
        
        const result = await this.client.query({query, format: 'JSONEachRow'})
        const rows = await result.json()
        return {field: safeField, groups: rows}
    }
    
    async createInstance(containerId: string, containerName: string): Promise<string> {
        const id = `inst_${containerId}_${Date.now()}`
        await this.client.insert({
            table: 'container_instances',
            values: [{
                id,
                container_id: containerId,
                container_name: containerName,
                started_at: nowISO().replace('T', ' ').substring(0, 19),
                stopped_at: null,
                status: 'running',
            }],
            format: 'JSONEachRow',
        })
        return id
    }
    
    async stopInstance(instanceId: string): Promise<void> {
        const escapedInstanceId = escapeClickHouseString(instanceId)
        // ClickHouse doesn't support UPDATE easily, use ALTER TABLE
        const stoppedAt = nowISO().replace('T', ' ').substring(0, 19)
        await this.client.exec({
            query: `ALTER TABLE container_instances UPDATE stopped_at = '${stoppedAt}', status = 'stopped' WHERE id = '${escapedInstanceId}'`,
        })
    }
    
    async getInstances(containerId: string, containerName?: string): Promise<ContainerInstance[]> {
        let query: string
        if (containerName) {
            query = `SELECT *
                     FROM container_instances
                     WHERE container_id = '${escapeClickHouseString(containerId)}'
                        OR container_name = '${escapeClickHouseString(containerName)}'
                     ORDER BY started_at DESC`
        } else {
            query = `SELECT *
                     FROM container_instances
                     WHERE container_id = '${escapeClickHouseString(containerId)}'
                     ORDER BY started_at DESC`
        }
        const result = await this.client.query({query, format: 'JSONEachRow'})
        const rows = await result.json()
        return rows.map((r: any) => ({
            id: r.id, containerId: r.container_id, containerName: r.container_name,
            startedAt: r.started_at, stoppedAt: r.stopped_at, status: r.status,
        }))
    }
    
    async getActiveInstance(containerId: string): Promise<ContainerInstance | null> {
        const result = await this.client.query({
            query: `SELECT *
                    FROM container_instances
                    WHERE container_id = '${escapeClickHouseString(containerId)}'
                      AND status = 'running'
                    ORDER BY started_at DESC LIMIT 1`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        if (!rows[0]) return null
        const r = rows[0]
        return {
            id: r.id,
            containerId: r.container_id,
            containerName: r.container_name,
            startedAt: r.started_at,
            stoppedAt: r.stopped_at,
            status: r.status
        }
    }
    
    async isContainerWatched(containerId: string): Promise<boolean> {
        const result = await this.client.query({
            query: `SELECT watched
                    FROM container_instances
                    WHERE container_id = '${escapeClickHouseString(containerId)}'
                    ORDER BY started_at DESC LIMIT 1`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        if (!rows[0]) return true
        return (rows[0] as any).watched === 1
    }
    
    async setContainerWatched(containerId: string, watched: boolean): Promise<void> {
        const escapedContainerId = escapeClickHouseString(containerId)
        await this.client.exec({
            query: `ALTER TABLE container_instances UPDATE watched = ${watched ? 1 : 0} WHERE container_id = '${escapedContainerId}'`,
        })
    }
    
    async getDistinctLevels(containerId: string): Promise<string[]> {
        const result = await this.client.query({
            query: `SELECT DISTINCT level
                    FROM log_entries
                    WHERE container_id = '${escapeClickHouseString(containerId)}'
                      AND level IS NOT NULL
                    ORDER BY level`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        return rows.map((r: any) => r.level)
    }
    
    async getDistinctFieldValues(containerId: string, field: string): Promise<string[]> {
        const safeField = assertSafeFieldName(field)
        const result = await this.client.query({
            query: `SELECT DISTINCT JSONExtractString(parsed_json, '${safeField}') as val
                    FROM log_entries
                    WHERE container_id = '${escapeClickHouseString(containerId)}'
                      AND is_json = 1
                    ORDER BY val LIMIT 100`,
            format: 'JSONEachRow',
        })
        const rows = await result.json()
        return rows.map((r: any) => r.val)
    }
    
    async deleteLogsByInstance(instanceId: string): Promise<void> {
        const escapedInstanceId = escapeClickHouseString(instanceId)
        await this.client.exec({query: `ALTER TABLE log_entries DELETE WHERE instance_id = '${escapedInstanceId}'`})
        await this.client.exec({query: `ALTER TABLE container_instances DELETE WHERE id = '${escapedInstanceId}'`})
    }
    
    async deleteLogsByContainer(containerId: string): Promise<void> {
        const escapedContainerId = escapeClickHouseString(containerId)
        await this.client.exec({query: `ALTER TABLE log_entries DELETE WHERE container_id = '${escapedContainerId}'`})
        await this.client.exec({query: `ALTER TABLE container_instances DELETE WHERE container_id = '${escapedContainerId}'`})
    }
    
    async deleteLogsBefore(cutoff: string): Promise<number> {
        const escapedCutoff = escapeClickHouseString(cutoff)
        await this.client.exec({
            query: `ALTER TABLE log_entries DELETE WHERE created_at < '${escapedCutoff}'`,
        })
        return 0
    }
    
    async deleteStoppedInstancesWithNoLogs(): Promise<number> {
        const result = await this.client.query({
            query: `SELECT ci.id
                    FROM container_instances ci LEFT ANTI JOIN log_entries le
                    ON ci.id = le.instance_id
                    WHERE ci.status = 'stopped'`,
            format: 'JSONEachRow',
        })
        const rows = await result.json() as any[]
        for (const row of rows) {
            const escapedId = escapeClickHouseString(row.id)
            await this.client.exec({
                query: `ALTER TABLE container_instances DELETE WHERE id = '${escapedId}'`,
            })
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
    
    private async createTables() {
        await this.client.exec({
            query: `CREATE DATABASE IF NOT EXISTS ${config.clickhouse.database}`,
        })
        
        await this.client.exec({
            query: `
                CREATE TABLE IF NOT EXISTS container_instances
                (
                    id
                    String,
                    container_id
                    String,
                    container_name
                    String,
                    started_at
                    DateTime,
                    stopped_at
                    Nullable
                (
                    DateTime
                ),
                    status String,
                    watched UInt8 DEFAULT 1
                    )
                    ENGINE = MergeTree
                (
                )
                    ORDER BY
                (
                    container_id,
                    started_at
                )
            `,
        })
        
        await this.client.exec({
            query: `
                CREATE TABLE IF NOT EXISTS log_entries
                (
                    id
                    UInt64,
                    container_id
                    String,
                    container_name
                    String,
                    instance_id
                    String,
                    timestamp
                    Nullable
                (
                    String
                ),
                    line_number UInt32,
                    raw_content String,
                    is_json UInt8,
                    parsed_json Nullable
                (
                    String
                ),
                    level Nullable
                (
                    String
                ),
                    content String,
                    has_sql UInt8,
                    sql Nullable
                (
                    String
                ),
                    created_at DateTime
                    )
                    ENGINE = MergeTree
                (
                )
                    ORDER BY
                (
                    container_id,
                    instance_id,
                    id
                )
            `,
        })
    }
    
    private rowToEntry(row: any): LogEntry {
        return {
            id: Number(row.id), containerId: row.container_id, containerName: row.container_name,
            instanceId: row.instance_id, timestamp: row.timestamp, lineNumber: row.line_number,
            rawContent: row.raw_content, isJson: row.is_json === 1, parsedJson: row.parsed_json,
            level: row.level, content: row.content, hasSql: row.has_sql === 1, sql: row.sql, createdAt: row.created_at,
        }
    }
}
