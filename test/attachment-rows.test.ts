/**
 * Attachments as rows (docs/spec/04-derived.md "SQLite").
 *
 * `test/attachments.test.ts` covers the gallery, which asks "which photos
 * belong to this game". This covers the table, which answers the narrower
 * question — which run, which session — that no derived artifact could answer
 * before, and the corrections the fold applies on the way there.
 */
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { attachmentRows } from '../src/core/attachments.ts'
import type { EventEnvelope } from '../src/core/events.ts'
import { readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { buildDatabase } from '../src/db/build.ts'
import { assetPath } from '../src/render/assets.ts'
import { csv } from '../src/targets/csv.ts'
import { json } from '../src/targets/json.ts'
import { DEFAULT_CONFIG } from '../src/core/config.ts'
import { translator } from '../src/i18n/index.ts'
import { context, event } from './helpers.ts'

const PHOTO = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

function attachment(sha256: string, caption: string | null): Record<string, unknown> {
  return { sha256, ext: 'webp', caption, captured_at: null, kind: 'screenshot' }
}

/** One game, one run, one session, closed — the shape every case below starts from. */
function baseLog(): EventEnvelope[] {
  return [
    event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' }),
    event('run.open', {
      run_id: 'R1',
      game_id: 'G1',
      platform: 'Switch',
      form: 'digital',
      mode: 'solo',
      started_on: '2026-05-03',
      replay: false,
    }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2026-05-03T20:00:00-03:00' }),
  ]
}

test('a session photo carries its session, its run and its game; a game photo carries only the game', () => {
  const events = baseLog()
  events.push(
    event('session.close', {
      session_id: 'S1',
      at: '2026-05-03T22:00:00-03:00',
      attachments: [attachment(PHOTO, 'Watcher Knights')],
    }),
    event('attachment.add', { target: 'G1', attachments: [attachment(OTHER, null)] }, '2026-05-04T09:00:00-03:00'),
  )

  const rows = attachmentRows(fold(events, context))
  assert.equal(rows.length, 2)

  const session = rows.find((row) => row.sha256 === PHOTO)
  assert.deepEqual(
    { game: session?.game_id, run: session?.run_id, session: session?.session_id },
    { game: 'G1', run: 'R1', session: 'S1' },
  )
  // The moment the photo was filed, which is the session's own close — not the
  // moment the event was written, and not the moment the fold ran.
  assert.equal(session?.filed_at, '2026-05-03T22:00:00-03:00')

  const game = rows.find((row) => row.sha256 === OTHER)
  assert.deepEqual(
    { game: game?.game_id, run: game?.run_id, session: game?.session_id },
    { game: 'G1', run: null, session: null },
  )
  assert.equal(game?.filed_at, '2026-05-04T09:00:00-03:00')
})

test('a photo on a run close carries the run and no session', () => {
  const events = baseLog()
  events.push(
    event('session.close', { session_id: 'S1', at: '2026-05-03T22:00:00-03:00' }),
    event('run.close', {
      run_id: 'R1',
      ended_on: '2026-05-03',
      outcome: 'finished',
      at: '2026-05-03T22:05:00-03:00',
      attachments: [attachment(PHOTO, 'The credits')],
    }),
  )

  const rows = attachmentRows(fold(events, context))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.run_id, 'R1')
  assert.equal(rows[0]?.session_id, null)
  assert.equal(rows[0]?.game_id, 'G1')
})

test('a revoked event takes its photo with it', () => {
  const events = baseLog()
  const close = event('session.close', {
    session_id: 'S1',
    at: '2026-05-03T22:00:00-03:00',
    attachments: [attachment(PHOTO, 'Watcher Knights')],
  })
  events.push(close, event('event.revoke', { target: close.id, reason: 'wrong session' }))

  assert.deepEqual(attachmentRows(fold(events, context)), [])
})

test('an amended caption is what the row carries', () => {
  const events = baseLog()
  const close = event('session.close', {
    session_id: 'S1',
    at: '2026-05-03T22:00:00-03:00',
    attachments: [attachment(PHOTO, 'Soul Master')],
  })
  events.push(
    close,
    event('event.amend', {
      target: close.id,
      reason: 'named the wrong boss',
      patch: { attachments: [attachment(PHOTO, 'Watcher Knights')] },
    }),
  )

  const rows = attachmentRows(fold(events, context))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.caption, 'Watcher Knights')
})

test('the same photo filed at two levels is two rows, and the gallery is what de-duplicates', () => {
  const events = baseLog()
  events.push(
    event('session.close', {
      session_id: 'S1',
      at: '2026-05-03T22:00:00-03:00',
      attachments: [attachment(PHOTO, 'Watcher Knights')],
    }),
    // The promotion path: the same hash filed against the game, then made the
    // cover. Two targets, two rows, one picture.
    event('attachment.add', { target: 'G1', attachments: [attachment(PHOTO, 'Watcher Knights')] }),
    event('game.cover', { game_id: 'G1', sha256: PHOTO, source: 'user' }),
  )

  const rows = attachmentRows(fold(events, context))
  assert.equal(rows.length, 2)
  assert.equal(new Set(rows.map((row) => row.sha256)).size, 1)
  assert.deepEqual(new Set(rows.map((row) => row.session_id)), new Set([null, 'S1']))
})

test('a retroactive add against an event counts once, under the event it names', () => {
  const events = baseLog()
  const close = event('session.close', { session_id: 'S1', at: '2026-05-03T22:00:00-03:00' })
  events.push(close, event('attachment.add', { target: close.id, attachments: [attachment(PHOTO, null)] }))

  // The fold keys the payload under the `attachment.add`'s own id as well as
  // under its target; only the target resolves to an entity, which is what
  // keeps one photo from becoming two rows.
  const rows = attachmentRows(fold(events, context))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.target, close.id)
  assert.equal(rows[0]?.session_id, 'S1')
})

test('rows are ordered by when they were filed, whatever order the log put them in', () => {
  const events = baseLog()
  events.push(
    event('session.close', {
      session_id: 'S1',
      at: '2026-05-03T22:00:00-03:00',
      attachments: [attachment(PHOTO, 'later')],
    }),
    // Filed after, about a moment before.
    event('attachment.add', { target: 'G1', attachments: [attachment(OTHER, 'earlier')] }, '2026-05-03T21:00:00-03:00'),
  )

  assert.deepEqual(
    attachmentRows(fold(events, context)).map((row) => row.caption),
    ['earlier', 'later'],
  )
})

/** `node:sqlite` reads only from a path, so the bytes go through a throwaway file. */
function columnsOf(bytes: Buffer, table: string): { columns: string[]; rows: number } {
  const dir = mkdtempSync(join(tmpdir(), 'gamereg-attachments-'))
  const file = join(dir, 'log.db')
  writeFileSync(file, bytes)
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const columns = (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map(
      (row) => row.name,
    )
    const rows = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n
    return { columns, rows }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * There is no `ext` column, and reintroducing one is the thing this test exists
 * to stop ([0107](../docs/decisions/0107-an-attachment-has-no-extension-to-vary.md)).
 *
 * The column used to be carried through all three targets while
 * `render/assets.ts` hardcoded `.webp`, so the artifacts implied a variability
 * the pipeline cannot produce: `test/ingest.test.ts` pins that every stored
 * attachment is the WebP `assetPath()` names. A row with an extension is a row
 * inviting a consumer to build a path from it, which is the wrong way to get the
 * right answer.
 */
test('no target carries an extension for an attachment', () => {
  const events = baseLog()
  events.push(
    event('session.close', {
      session_id: 'S1',
      at: '2026-05-03T22:00:00-03:00',
      // The legacy field, as every event written so far carries it, plus a
      // payload that lies about it: neither reaches a row, and the file both
      // describe is the same one.
      attachments: [
        { sha256: PHOTO, ext: 'webp', caption: null, captured_at: null, kind: 'screenshot' },
        { sha256: OTHER, ext: 'png', caption: null, captured_at: null, kind: 'photo' },
      ],
    }),
  )
  const state = fold(events, context)

  const rows = attachmentRows(state)
  assert.equal(rows.length, 2)
  for (const row of rows) {
    assert.equal('ext' in row, false, 'attachmentRows grew an ext field back')
    assert.match(assetPath(row.sha256), /\.webp$/)
  }

  // The fold normalizes rather than trusting: `ext: 'png'` names no file.
  for (const attachments of state.attachments.values()) {
    for (const attachment of attachments) assert.equal(attachment.ext, 'webp')
  }

  const target = { config: structuredClone(DEFAULT_CONFIG), bundle: translator('en') }
  const header = String(csv.plan(state, target).find((file) => file.path.endsWith('attachments.csv'))?.content)
    .split('\n')[0]
    ?.split(',')
  assert.equal(header?.includes('ext'), false)

  const payload = JSON.parse(String(json.plan(state, target)[0]?.content)) as {
    attachments: Record<string, unknown>[]
  }
  assert.equal('ext' in payload.attachments[0]!, false)

  assert.equal(columnsOf(buildDatabase(state), 'attachments').columns.includes('ext'), false)
})

test('sqlite, csv and json agree on the columns and on how many rows there are', () => {
  const vault = openVault(join(import.meta.dirname, '..', 'example-vault'))
  const state = fold(readEvents(vault.eventsFile), timeContext(vault))
  const rows = attachmentRows(state)
  assert.ok(rows.length > 0, 'the example vault files no attachments at all')

  const database = columnsOf(buildDatabase(state), 'attachments')
  const expected = Object.keys(rows[0]!)

  assert.deepEqual(database.columns, expected)
  assert.equal(database.rows, rows.length)

  const target = { config: structuredClone(DEFAULT_CONFIG), bundle: translator('en') }
  const csvFile = csv.plan(state, target).find((file) => file.path.endsWith('attachments.csv'))
  assert.notEqual(csvFile, undefined)
  const lines = String(csvFile?.content).split('\n')
  assert.deepEqual(lines[0]?.split(','), expected)
  assert.equal(lines.length - 1, rows.length)

  const payload = JSON.parse(String(json.plan(state, target)[0]?.content)) as {
    attachments: Record<string, unknown>[]
  }
  assert.equal(payload.attachments.length, rows.length)
  assert.deepEqual(Object.keys(payload.attachments[0]!), expected)
})
