/**
 * The `sqlite` target (docs/spec/04-derived.md "SQLite", 07-targets.md
 * "sqlite"). Exercised directly, in addition to the golden coverage it gets
 * through `gamereg build` once declared in example-vault's config.
 */
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readEvents } from '../src/core/events.ts'
import { fold, type VaultState } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { buildDatabase } from '../src/db/build.ts'
import { canonicalizeState } from '../src/targets/build.ts'
import { sqlite } from '../src/targets/sqlite.ts'
import { translator } from '../src/i18n/index.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function exampleState(): VaultState {
  const vault = openVault(EXAMPLE)
  return fold(readEvents(vault.eventsFile), timeContext(vault))
}

/** `node:sqlite` reads only from a path, so the bytes are round-tripped through a throwaway file. */
function open(bytes: Buffer): { db: DatabaseSync; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gamereg-sqlite-read-'))
  const file = join(dir, 'log.db')
  writeFileSync(file, bytes)
  const db = new DatabaseSync(file, { readOnly: true })
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('the same state produces byte-identical databases across builds', () => {
  const state = exampleState()
  const first = buildDatabase(state)
  const second = buildDatabase(state)
  assert.equal(Buffer.compare(first, second), 0)
})

test('a fixed page size, set before any table exists', () => {
  const { db, cleanup } = open(buildDatabase(exampleState()))
  try {
    const row = db.prepare('PRAGMA page_size;').get() as { page_size: number }
    assert.equal(row.page_size, 4096)
  } finally {
    cleanup()
  }
})

test('a run carries both the canonical platform and the one the log holds', () => {
  const vault = openVault(EXAMPLE)
  const state = fold(readEvents(vault.eventsFile), timeContext(vault))
  const { db, cleanup } = open(
    buildDatabase(canonicalizeState(state, vault.config)),
  )
  try {
    const rows = db
      .prepare('SELECT platform, platform_raw FROM runs ORDER BY started_on')
      .all() as { platform: string | null; platform_raw: string | null }[]

    // Group by the first, audit with the second: "SNES" was typed, "Super
    // Nintendo" is what every report agrees to call it.
    assert.equal(rows[0]?.platform, 'Super Nintendo')
    assert.equal(rows[0]?.platform_raw, 'SNES')
    // A run nobody has answered for is null in both, not an empty string.
    assert.equal(rows.at(-1)?.platform, null)
    assert.equal(rows.at(-1)?.platform_raw, null)
  } finally {
    cleanup()
  }
})

test('games, runs and sessions round-trip with the same counts as the fold', () => {
  const state = exampleState()
  const { db, cleanup } = open(buildDatabase(state))
  try {
    const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

    const runs = state.games.flatMap((game) => game.runs)
    const sessions = runs.flatMap((run) => run.sessions)
    const breaks = sessions.flatMap((session) => session.breaks)

    assert.equal(count('games'), state.games.length)
    assert.equal(count('runs'), runs.length)
    assert.equal(count('sessions'), sessions.length)
    assert.equal(count('breaks'), breaks.length)
    assert.equal(count('events'), state.eventsById.size)
  } finally {
    cleanup()
  }
})

test('a game row carries the columns csv.ts also emits, same names', () => {
  const { db, cleanup } = open(buildDatabase(exampleState()))
  try {
    const row = db
      .prepare('SELECT game_id, slug, title, release_year, developer, publisher, status FROM games WHERE slug = ?')
      .get('hollow-knight') as Record<string, unknown>
    assert.equal(row['title'], 'Hollow Knight')
    assert.equal(row['status'], 'finished')
  } finally {
    cleanup()
  }
})

test('v_finished has one row per finished run, and excludes open or abandoned ones', () => {
  const state = exampleState()
  const runs = state.games.flatMap((game) => game.runs)
  const finished = runs.filter((run) => run.outcome === 'finished').length

  const { db, cleanup } = open(buildDatabase(state))
  try {
    const count = (db.prepare('SELECT COUNT(*) AS n FROM v_finished').get() as { n: number }).n
    assert.equal(count, finished)
    assert.ok(count > 0)

    const outcomes = db.prepare('SELECT DISTINCT outcome FROM runs WHERE run_id IN (SELECT run_id FROM v_finished)').all()
    for (const row of outcomes) assert.equal((row as { outcome: string }).outcome, 'finished')
  } finally {
    cleanup()
  }
})

test('v_by_year groups by the first four characters of ended_on, at any precision', () => {
  const { db, cleanup } = open(buildDatabase(exampleState()))
  try {
    const rows = db.prepare('SELECT year, runs, hours FROM v_by_year ORDER BY year').all() as {
      year: string
      runs: number
      hours: number
    }[]
    assert.ok(rows.length > 0)
    for (const row of rows) assert.match(row.year, /^\d{4}$/)
  } finally {
    cleanup()
  }
})

test('v_sessions_by_day sums minutes into hours per logical day', () => {
  const { db, cleanup } = open(buildDatabase(exampleState()))
  try {
    const rows = db.prepare('SELECT logical_day, sessions, hours FROM v_sessions_by_day').all() as {
      logical_day: string
      sessions: number
    }[]
    assert.ok(rows.length > 0)
    for (const row of rows) assert.ok(row.sessions >= 1)
  } finally {
    cleanup()
  }
})

test('the sqlite target plans exactly data/log.db, replace policy', () => {
  const planned = sqlite.plan(exampleState(), { config: openVault(EXAMPLE).config, bundle: translator('en') })
  assert.equal(planned.length, 1)
  assert.equal(planned[0]!.path, 'data/log.db')
  assert.equal(planned[0]!.policy, 'replace')
  assert.ok(Buffer.isBuffer(planned[0]!.content))
})
