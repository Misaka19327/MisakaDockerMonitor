import mysql from 'mysql2/promise'
import { config } from '../config'
import type { StorageAdapter, LogEntry, LogQueryParams, LogQueryResult, ContainerInstance, GroupResult } from './index'

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

  private async createTables() {
    const conn = await this.pool.getConnection()
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS container_instances (
          id VARCHAR(100) PRIMARY KEY,
          container_id VARCHAR(100) NOT NULL,
          container_name VARCHAR(255) NOT NULL,
          started_at DATETIME NOT NULL,
          stopped_at DATETIME NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'running',
          INDEX idx_ci_container (container_id)
        )
      `)

      await conn.execute(`
        CREATE TABLE IF NOT EXISTS log_entries (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          container_id VARCHAR(100) NOT NULL,
          container_name VARCHAR(255) NOT NULL,
          instance_id VARCHAR(100) NOT NULL,
          timestamp VARCHAR(100) NULL,
          line_number INT NOT NULL,
          raw_content TEXT NOT NULL,
          is_json TINYINT NOT NULL DEFAULT 0,
          parsed_json JSON NULL,
          level VARCHAR(50) NULL,
          content TEXT NOT NULL,
          has_sql TINYINT NOT NULL DEFAULT 0,
          sql_text MEDIUMTEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_le_container (container_id),
          INDEX idx_le_instance (instance_id),
          INDEX idx_le_level (level),
          INDEX idx_le_timestamp (timestamp)
        )
      `)
    } finally {
      conn.release()
    }
  }

  async insertLog(entry: LogEntry): Promise<void> {
    await this.pool.execute(
      `INSERT INTO log_entries (container_id, container_name, instance_id, timestamp, line_number, raw_content, is_json, parsed_json, level, content, has_sql, sql_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.containerId, entry.containerName, entry.instanceId, entry.timestamp, entry.lineNumber, entry.rawContent, entry.isJson ? 1 : 0, entry.parsedJson, entry.level, entry.content, entry.hasSql ? 1 : 0, entry.sql, entry.createdAt],
    )
  }

  async insertLogs(entries: LogEntry[]): Promise<void> {
    const conn = await this.pool.getConnection()
    try {
      await conn.beginTransaction()
      for (const entry of entries) {
        await conn.execute(
          `INSERT INTO log_entries (container_id, container_name, instance_id, timestamp, line_number, raw_content, is_json, parsed_json, level, content, has_sql, sql_text, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entry.containerId, entry.containerName, entry.instanceId, entry.timestamp, entry.lineNumber, entry.rawContent, entry.isJson ? 1 : 0, entry.parsedJson, entry.level, entry.content, entry.hasSql ? 1 : 0, entry.sql, entry.createdAt],
        )
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
    const { containerId, instanceId, search, level, startTime, endTime, limit = 200, offset = 0 } = params

    const conditions: string[] = ['container_id = ?']
    const values: any[] = [containerId]

    if (instanceId) { conditions.push('instance_id = ?'); values.push(instanceId) }
    if (search) { conditions.push('(content LIKE ? OR raw_content LIKE ?)'); values.push(`%${search}%`, `%${search}%`) }
    if (level) { conditions.push('level = ?'); values.push(level) }
    if (startTime) { conditions.push('timestamp >= ?'); values.push(startTime) }
    if (endTime) { conditions.push('timestamp <= ?'); values.push(endTime) }

    const where = conditions.join(' AND ')

    const [countRows] = await this.pool.execute(`SELECT COUNT(*) as total FROM log_entries WHERE ${where}`, values) as any
    const total = countRows[0]?.total ?? 0

    const [rows] = await this.pool.execute(
      `SELECT * FROM log_entries WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...values, String(limit), String(offset)],
    ) as any

    return {
      entries: (rows as any[]).map(r => this.rowToEntry(r)),
      total,
      hasMore: offset + limit < total,
    }
  }

  async groupByField(containerId: string, field: string, instanceId?: string): Promise<GroupResult> {
    const conditions = ['container_id = ?', 'level IS NOT NULL']
    const values: any[] = [containerId]
    if (instanceId) { conditions.push('instance_id = ?'); values.push(instanceId) }

    if (field === 'level') {
      const [rows] = await this.pool.execute(
        `SELECT level as value, COUNT(*) as count FROM log_entries WHERE ${conditions.join(' AND ')} GROUP BY level ORDER BY count DESC LIMIT 100`,
        values,
      ) as any
      return { field, groups: rows }
    }

    const jsonConditions = ['container_id = ?', 'is_json = 1', `JSON_EXTRACT(parsed_json, '$.${field}') IS NOT NULL`]
    const jsonValues: any[] = [containerId]
    if (instanceId) { jsonConditions.push('instance_id = ?'); jsonValues.push(instanceId) }

    const [rows] = await this.pool.execute(
      `SELECT JSON_EXTRACT(parsed_json, '$.${field}') as value, COUNT(*) as count FROM log_entries WHERE ${jsonConditions.join(' AND ')} GROUP BY value ORDER BY count DESC LIMIT 100`,
      jsonValues,
    ) as any
    return { field, groups: rows }
  }

  async createInstance(containerId: string, containerName: string): Promise<string> {
    const id = `inst_${containerId}_${Date.now()}`
    await this.pool.execute(
      `INSERT INTO container_instances (id, container_id, container_name, started_at, status) VALUES (?, ?, ?, ?, 'running')`,
      [id, containerId, containerName, new Date().toISOString()],
    )
    return id
  }

  async stopInstance(instanceId: string): Promise<void> {
    await this.pool.execute(`UPDATE container_instances SET stopped_at = ?, status = 'stopped' WHERE id = ?`, [new Date().toISOString(), instanceId])
  }

  async getInstances(containerId: string): Promise<ContainerInstance[]> {
    const [rows] = await this.pool.execute(`SELECT * FROM container_instances WHERE container_id = ? ORDER BY started_at DESC`, [containerId]) as any
    return (rows as any[]).map(r => ({
      id: r.id, containerId: r.container_id, containerName: r.container_name,
      startedAt: r.started_at, stoppedAt: r.stopped_at, status: r.status,
    }))
  }

  async getActiveInstance(containerId: string): Promise<ContainerInstance | null> {
    const [rows] = await this.pool.execute(
      `SELECT * FROM container_instances WHERE container_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`, [containerId],
    ) as any
    const row = (rows as any[])[0]
    if (!row) return null
    return { id: row.id, containerId: row.container_id, containerName: row.container_name, startedAt: row.started_at, stoppedAt: row.stopped_at, status: row.status }
  }

  async getDistinctLevels(containerId: string): Promise<string[]> {
    const [rows] = await this.pool.execute(`SELECT DISTINCT level FROM log_entries WHERE container_id = ? AND level IS NOT NULL`, [containerId]) as any
    return (rows as any[]).map(r => r.level)
  }

  async getDistinctFieldValues(containerId: string, field: string): Promise<string[]> {
    const [rows] = await this.pool.execute(
      `SELECT DISTINCT JSON_EXTRACT(parsed_json, '$.${field}') as val FROM log_entries WHERE container_id = ? AND is_json = 1 AND JSON_EXTRACT(parsed_json, '$.${field}') IS NOT NULL LIMIT 100`,
      [containerId],
    ) as any
    return (rows as any[]).map(r => r.val)
  }

  async deleteLogsByInstance(instanceId: string): Promise<void> {
    await this.pool.execute('DELETE FROM log_entries WHERE instance_id = ?', [instanceId])
    await this.pool.execute('DELETE FROM container_instances WHERE id = ?', [instanceId])
  }

  async deleteLogsByContainer(containerId: string): Promise<void> {
    await this.pool.execute('DELETE FROM log_entries WHERE container_id = ?', [containerId])
    await this.pool.execute('DELETE FROM container_instances WHERE container_id = ?', [containerId])
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private rowToEntry(row: any): LogEntry {
    return {
      id: row.id, containerId: row.container_id, containerName: row.container_name,
      instanceId: row.instance_id, timestamp: row.timestamp, lineNumber: row.line_number,
      rawContent: row.raw_content, isJson: row.is_json === 1, parsedJson: typeof row.parsed_json === 'object' ? JSON.stringify(row.parsed_json) : row.parsed_json,
      level: row.level, content: row.content, hasSql: row.has_sql === 1, sql: row.sql_text, createdAt: row.created_at,
    }
  }
}
