import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
