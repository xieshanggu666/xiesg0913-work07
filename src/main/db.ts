import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import type { SnapshotRecord, StoryboardPresetRecord } from '../shared/types'

let db: Database.Database | null = null

export function openDatabase(): Database.Database {
  if (db) return db
  const file = app.isPackaged
    ? join(app.getPath('userData'), 'glass-forge.db')
    : join(app.getPath('userData'), 'glass-forge-dev.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      glass_json TEXT NOT NULL,
      thumb TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS storyboard_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      queue_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  return db
}

interface SnapshotRow {
  id: number
  title: string
  note: string
  created_at: number
  glass_json: string
  thumb: string
}

export function listSnapshots(): SnapshotRecord[] {
  const rows = openDatabase()
    .prepare('SELECT * FROM snapshots ORDER BY created_at DESC')
    .all() as SnapshotRow[]
  return rows
}

export function insertSnapshot(
  record: Omit<SnapshotRecord, 'id' | 'created_at'>
): SnapshotRecord {
  const created_at = Date.now()
  const info = openDatabase()
    .prepare(
      'INSERT INTO snapshots (title, note, created_at, glass_json, thumb) VALUES (?, ?, ?, ?, ?)'
    )
    .run(record.title, record.note, created_at, record.glass_json, record.thumb)
  return { ...record, id: Number(info.lastInsertRowid), created_at }
}

export function deleteSnapshot(id: number): void {
  openDatabase().prepare('DELETE FROM snapshots WHERE id = ?').run(id)
}

interface PresetRow {
  id: number
  name: string
  title: string
  queue_json: string
  created_at: number
}

function rowToPreset(row: PresetRow): StoryboardPresetRecord {
  let queue: StoryboardPresetRecord['queue'] = []
  try {
    const parsed = JSON.parse(row.queue_json) as unknown
    if (Array.isArray(parsed)) {
      queue = parsed.filter(
        (q): q is { id: number; on: boolean } =>
          typeof q === 'object' && q != null && typeof q.id === 'number' && typeof q.on === 'boolean'
      )
    }
  } catch {
    queue = []
  }
  return { id: row.id, name: row.name, title: row.title, queue, created_at: row.created_at }
}

export function listPresets(): StoryboardPresetRecord[] {
  const rows = openDatabase()
    .prepare('SELECT * FROM storyboard_presets ORDER BY created_at ASC, id ASC')
    .all() as PresetRow[]
  return rows.map(rowToPreset)
}

export function insertPreset(
  record: Omit<StoryboardPresetRecord, 'id' | 'created_at'>
): StoryboardPresetRecord {
  const created_at = Date.now()
  const info = openDatabase()
    .prepare('INSERT INTO storyboard_presets (name, title, queue_json, created_at) VALUES (?, ?, ?, ?)')
    .run(record.name, record.title, JSON.stringify(record.queue), created_at)
  return { ...record, id: Number(info.lastInsertRowid), created_at }
}

export function deletePreset(id: number): void {
  openDatabase().prepare('DELETE FROM storyboard_presets WHERE id = ?').run(id)
}
