import { Database, type SQLQueryBindings } from 'bun:sqlite'
import { config } from '../config'
import { ensureDataDir } from '../config'
import { nowISO, isSafeFieldName } from '../utils'
import type { StorageAdapter, LogEntry, LogQueryParams, LogQueryResult, ContainerInstance, GroupResult } from './index'

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

  private createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS container_instances (
        id TEXT PRIMARY KEY,
        container_id TEXT NOT NULL,
        container_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        watched INTEGER NOT NULL DEFAULT 1
      )
    `)
    try { this.db.run('ALTER TABLE container_instances ADD COLUMN watched INTEGER NOT NULL DEFAULT 1') } catch {}

    this.db.run(`
      CREATE TABLE IF NOT EXISTS log_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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

    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_container ON log_entries(container_id)')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_instance ON log_entries(instance_id)')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_level ON log_entries(level)')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON log_entries(timestamp)')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_created_at ON log_entries(created_at)')
  }

  async insertLog(entry: LogEntry): Promise<void> {
    if (!this.insertStmt) {
      this.insertStmt = this.db.prepare(
        `INSERT INTO log_entries (container_id, container_name, instance_id, timestamp, line_number, raw_content, is_json, parsed_json, level, content, has_sql, sql, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
    }
    this.insertStmt.run(
      entry.containerId, entry.containerName, entry.instanceId, entry.timestamp,
      entry.lineNumber, entry.rawContent, entry.isJson ? 1 : 0, entry.parsedJson,
      entry.level, entry.content, entry.hasSql ? 1 : 0, entry.sql, entry.createdAt,
    )
  }

  async insertLogs(entries: LogEntry[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO log_entries (container_id, container_name, instance_id, timestamp, line_number, raw_content, is_json, parsed_json, level, content, has_sql, sql, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    const tx = this.db.transaction((items: LogEntry[]) => {
      for (const entry of items) {
        stmt.run(
          entry.containerId, entry.containerName, entry.instanceId, entry.timestamp,
          entry.lineNumber, entry.rawContent, entry.isJson ? 1 : 0, entry.parsedJson,
          entry.level, entry.content, entry.hasSql ? 1 : 0, entry.sql, entry.createdAt,
        )
      }
    })

    tx(entries)
  }

  async queryLogs(params: LogQueryParams): Promise<LogQueryResult> {
    const { containerId, instanceId, search, level, startTime, endTime, field, fieldValue, limit = 200, offset = 0 } = params

    const conditions: string[] = ['container_id = ?']
    const values: SQLQueryBindings[] = [containerId]

    if (instanceId) { conditions.push('instance_id = ?'); values.push(instanceId) }
    if (search) { conditions.push('(content LIKE ? OR raw_content LIKE ?)'); values.push(`%${search}%`, `%${search}%`) }
    if (level) { conditions.push('level = ?'); values.push(level) }
    if (startTime) { conditions.push('timestamp >= ?'); values.push(startTime) }
    if (endTime) { conditions.push('timestamp <= ?'); values.push(endTime) }
    if (field && fieldValue && field !== 'level') {
      conditions.push('parsed_json LIKE ?')
      values.push(`%"${field}":"${fieldValue}"%`)
    }

    const where = conditions.join(' AND ')

    const countRow = this.db.query(`SELECT COUNT(*) as total FROM log_entries WHERE ${where}`).get(...values) as { total: number } | null
    const total = countRow?.total ?? 0

    const rows = this.db.query(`
      SELECT * FROM (
        SELECT * FROM log_entries WHERE ${where}
        ORDER BY id DESC LIMIT ? OFFSET ?
      ) ORDER BY id ASC
    `).all(...values, limit, offset) as any[]

    return {
      entries: rows.map(r => this.rowToEntry(r)),
      total,
      hasMore: offset + limit < total,
    }
  }

  private validateField(field: string): void {
    if (!isSafeFieldName(field)) {
      throw new Error(`Invalid field name: ${field}`)
    }
  }

  async groupByField(containerId: string, field: string, instanceId?: string): Promise<GroupResult> {
    this.validateField(field)
    let queryStr: string
    let values: SQLQueryBindings[]

    if (field === 'level') {
      queryStr = 'SELECT level as value, COUNT(*) as count FROM log_entries WHERE container_id = ? AND level IS NOT NULL'
      values = [containerId]
      if (instanceId) { queryStr += ' AND instance_id = ?'; values.push(instanceId) }
      queryStr += ' GROUP BY level ORDER BY count DESC LIMIT 100'
    } else {
      queryStr = `SELECT json_extract(parsed_json, '$.${field}') as value, COUNT(*) as count FROM log_entries WHERE container_id = ? AND is_json = 1 AND json_extract(parsed_json, '$.${field}') IS NOT NULL`
      values = [containerId]
      if (instanceId) { queryStr += ' AND instance_id = ?'; values.push(instanceId) }
      queryStr += ` GROUP BY value ORDER BY count DESC LIMIT 100`
    }

    const rows = this.db.query(queryStr).all(...values) as { value: string; count: number }[]
    return { field, groups: rows }
  }

  async createInstance(containerId: string, containerName: string): Promise<string> {
    const id = `inst_${containerId}_${Date.now()}`
    this.db.run(
      `INSERT INTO container_instances (id, container_id, container_name, started_at, status) VALUES (?, ?, ?, ?, 'running')`,
      [id, containerId, containerName, nowISO()],
    )
    return id
  }

  async stopInstance(instanceId: string): Promise<void> {
    this.db.run(
      `UPDATE container_instances SET stopped_at = ?, status = 'stopped' WHERE id = ?`,
      [nowISO(), instanceId],
    )
  }

  async getInstances(containerId: string): Promise<ContainerInstance[]> {
    const rows = this.db.query(`SELECT * FROM container_instances WHERE container_id = ? ORDER BY started_at DESC`).all(containerId) as any[]
    return rows.map(r => ({
      id: r.id, containerId: r.container_id, containerName: r.container_name,
      startedAt: r.started_at, stoppedAt: r.stopped_at, status: r.status,
    }))
  }

  async getActiveInstance(containerId: string): Promise<ContainerInstance | null> {
    const row = this.db.query(
      `SELECT * FROM container_instances WHERE container_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
    ).get(containerId) as any

    if (!row) return null
    return {
      id: row.id, containerId: row.container_id, containerName: row.container_name,
      startedAt: row.started_at, stoppedAt: row.stopped_at, status: row.status,
    }
  }

  async isContainerWatched(containerId: string): Promise<boolean> {
    const row = this.db.query(
      `SELECT watched FROM container_instances WHERE container_id = ? ORDER BY started_at DESC LIMIT 1`,
    ).get(containerId) as { watched: number } | null
    return row ? row.watched === 1 : true
  }

  async setContainerWatched(containerId: string, watched: boolean): Promise<void> {
    this.db.run(
      `UPDATE container_instances SET watched = ? WHERE container_id = ?`,
      [watched ? 1 : 0, containerId],
    )
  }

  async getDistinctLevels(containerId: string): Promise<string[]> {
    const rows = this.db.query(
      `SELECT DISTINCT level FROM log_entries WHERE container_id = ? AND level IS NOT NULL ORDER BY level`,
    ).all(containerId) as { level: string }[]
    return rows.map(r => r.level)
  }

  async getDistinctFieldValues(containerId: string, field: string): Promise<string[]> {
    this.validateField(field)
    const rows = this.db.query(
      `SELECT DISTINCT json_extract(parsed_json, '$.${field}') as val FROM log_entries
       WHERE container_id = ? AND is_json = 1 AND json_extract(parsed_json, '$.${field}') IS NOT NULL
       ORDER BY val LIMIT 100`,
    ).all(containerId) as { val: string }[]
    return rows.map(r => r.val)
  }

  async deleteLogsByInstance(instanceId: string): Promise<void> {
    this.db.run('DELETE FROM log_entries WHERE instance_id = ?', [instanceId])
    this.db.run('DELETE FROM container_instances WHERE id = ?', [instanceId])
  }

  async deleteLogsByContainer(containerId: string): Promise<void> {
    this.db.run('DELETE FROM log_entries WHERE container_id = ?', [containerId])
    this.db.run('DELETE FROM container_instances WHERE container_id = ?', [containerId])
  }

  async deleteLogsBefore(cutoff: string): Promise<number> {
    const result = this.db.run(
      'DELETE FROM log_entries WHERE created_at < ?',
      [cutoff],
    )
    return result.changes
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

  private rowToEntry(row: any): LogEntry {
    return {
      id: row.id, containerId: row.container_id, containerName: row.container_name,
      instanceId: row.instance_id, timestamp: row.timestamp, lineNumber: row.line_number,
      rawContent: row.raw_content, isJson: row.is_json === 1, parsedJson: row.parsed_json,
      level: row.level, content: row.content, hasSql: row.has_sql === 1, sql: row.sql,
      createdAt: row.created_at,
    }
  }
}
