import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { EventEnvelope, EventType } from '../src/core/events.ts'
import { SCHEMA_VERSION } from '../src/core/events.ts'
import type { TimeContext } from '../src/core/time.ts'

export const ZONE = 'America/Sao_Paulo'

export const context: TimeContext = { zone: ZONE, dayCutoff: '05:00' }

let counter = 0

/** Deterministic, sortable, ULID-shaped ids — the fold only needs file order. */
export function id(prefix = '01K2X8F3QJ'): string {
  counter += 1
  return `${prefix}${String(counter).padStart(16, '0')}`.slice(0, 26).toUpperCase()
}

export function event(type: EventType, data: Record<string, unknown>, ts = '2026-05-03T20:00:00-03:00'): EventEnvelope {
  return { id: id(), ts, type, source: 'cli', schema: SCHEMA_VERSION, data }
}

export function tempDir(prefix = 'gamereg-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  process.on('exit', () => {
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return `x'${Buffer.from(value).toString('hex')}'`
  return JSON.stringify(value)
}

/**
 * A SQLite file as comparable text: its schema, then every table and view row
 * by row, one `column=value` line each.
 *
 * This exists because the same logical database is not the same bytes across
 * SQLite versions — Node v26.0.0 bundles 3.53.1 and v26.7.0 bundles 3.53.4,
 * and a file built by one differs from a file built by the other with no
 * difference in content. A committed fixture therefore cannot be compared byte
 * for byte by whoever happens to clone the repo, so it is compared through
 * this instead. Determinism is still asserted on the bytes themselves, where
 * both files come from one machine and one library version (the idempotency
 * test in golden.test.ts, and non-negotiable 2 in CLAUDE.md).
 *
 * Rows come out in each object's own order — for a table that is rowid, hence
 * the build's insertion order, which is deterministic by construction and part
 * of what the fixture freezes; for a view it is whatever the view's own SQL
 * defines. Neither is re-sorted here: a change in either is a real change in
 * the artifact and should show up as a diff.
 */
export function dumpDatabase(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    // `sqlite_%` skips the internal bookkeeping (autoindexes over the TEXT
    // primary keys, chiefly), which is exactly the layer that is free to
    // differ between library versions.
    const objects = db
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .all() as { type: string; name: string; sql: string | null }[]

    const lines: string[] = []
    for (const object of objects) {
      lines.push(`-- ${object.type} ${object.name}`, (object.sql ?? '').trim())
    }
    for (const object of objects) {
      if (object.type !== 'table' && object.type !== 'view') continue
      lines.push(`-- rows ${object.name}`)
      for (const row of db.prepare(`SELECT * FROM "${object.name}"`).all()) {
        lines.push(
          Object.entries(row as Record<string, unknown>)
            .map(([column, value]) => `${column}=${sqlValue(value)}`)
            .join(' | '),
        )
      }
    }
    return `${lines.join('\n')}\n`
  } finally {
    db.close()
  }
}
