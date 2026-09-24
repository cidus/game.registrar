/**
 * A game's cover as columns on `games` (docs/spec/04-derived.md "SQLite",
 * [0107](../docs/decisions/0107-the-cover-is-three-columns-on-games.md)).
 *
 * `test/attachment-rows.test.ts` covers the photos filed against an event.
 * This covers the one assertion that is *not* one of those: exactly one
 * replaceable image per game, which never reaches `state.attachments` when it
 * came from a provider and carries no "this is the cover" flag when it came
 * from a photo.
 *
 * Driven off `example-vault/`, which exercises every shape the columns can
 * take — a user promotion, a downloaded provider cover, the legacy bare-URL
 * one, and two games with no cover at all — so that a fixture and a unit test
 * cannot drift apart about what the emitted values are.
 */
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { parseCsv } from '../src/cli/csv-parse.ts'
import { DEFAULT_CONFIG } from '../src/core/config.ts'
import { readEvents } from '../src/core/events.ts'
import { fold, type VaultState } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { buildDatabase } from '../src/db/build.ts'
import { csv } from '../src/targets/csv.ts'
import { json } from '../src/targets/json.ts'
import { translator } from '../src/i18n/index.ts'
import { context, event } from './helpers.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

const COLUMNS = ['cover_sha256', 'cover_url', 'cover_source'] as const

type CoverRow = { cover_sha256: string | null; cover_url: string | null; cover_source: string | null }

function exampleState(): VaultState {
  const vault = openVault(EXAMPLE)
  return fold(readEvents(vault.eventsFile), timeContext(vault))
}

function targetContext(): { config: typeof DEFAULT_CONFIG; bundle: ReturnType<typeof translator> } {
  return { config: structuredClone(DEFAULT_CONFIG), bundle: translator('en') }
}

/** `node:sqlite` reads only from a path, so the bytes are round-tripped through a throwaway file. */
function query<T>(bytes: Buffer, read: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'gamereg-cover-'))
  const file = join(dir, 'log.db')
  writeFileSync(file, bytes)
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return read(db)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The three columns per slug, as SQLite has them. */
function fromSqlite(state: VaultState): Map<string, CoverRow> {
  return query(buildDatabase(state), (db) => {
    const rows = db
      .prepare(`SELECT slug, ${COLUMNS.join(', ')} FROM games`)
      .all() as ({ slug: string } & CoverRow)[]
    return new Map(
      rows.map((row) => [
        row.slug,
        { cover_sha256: row.cover_sha256, cover_url: row.cover_url, cover_source: row.cover_source },
      ]),
    )
  })
}

test('a cover promoted from the user’s own photo is a hash with no url, sourced to the user', () => {
  const row = fromSqlite(exampleState()).get('hollow-knight')
  assert.equal(row?.cover_source, 'user')
  assert.equal(row?.cover_sha256, 'bb00bde27859e8916627ad3d9d9f4c037556f9df44958db277801d28e24761a9')
  // Measured on the live vault: 5 of 5 user promotions carry no url.
  assert.equal(row?.cover_url, null)
})

test('a downloaded provider cover carries both the hash and the url', () => {
  const row = fromSqlite(exampleState()).get('outer-wilds')
  assert.equal(row?.cover_source, 'provider')
  assert.equal(row?.cover_sha256, 'f04ac466a0d7824a8bfb26ae9f50a960b3cdf2bf3dab07596ddeba13f62d54e2')
  assert.equal(row?.cover_url, 'https://images.example/covers/outer-wilds.webp')
})

/**
 * Invariant 11 ([0024](../docs/decisions/0024-user-covers-are-never-replaced.md))
 * at the derived layer, which is the whole reason `cover_source` is carried
 * rather than dropped: the fixture's Hollow Knight is enriched *after* the
 * user set its cover, with a provider cover that was even downloaded, and the
 * columns still say the user's.
 */
test('enrichment against a user cover leaves all three columns alone', () => {
  const state = exampleState()
  const enrich = [...state.eventsById.values()].find(
    (candidate) =>
      candidate.type === 'game.enrich' && candidate.data['game_id'] === '01K5A00000000000000000GAM1',
  )
  assert.notEqual(enrich, undefined, 'the fixture no longer enriches the game whose cover the user set')

  assert.deepEqual(fromSqlite(state).get('hollow-knight'), {
    cover_sha256: 'bb00bde27859e8916627ad3d9d9f4c037556f9df44958db277801d28e24761a9',
    cover_url: null,
    cover_source: 'user',
  })
})

/**
 * The shape `game.enrich` carried before covers were downloaded: `cover` as a
 * bare URL string. The log is append-only, so `fold.ts` reads it forever, and
 * a URL on record with no bytes behind it is why `cover_sha256` cannot be
 * `NOT NULL` however many rows a live vault happens to have.
 */
test('a cover recorded as a bare url is a url with no hash', () => {
  const row = fromSqlite(exampleState()).get('chrono-trigger')
  assert.equal(row?.cover_source, 'provider')
  assert.equal(row?.cover_url, 'https://images.example/covers/chrono-trigger.jpg')
  assert.equal(row?.cover_sha256, null)
})

test('a game with no cover is three nulls, never an empty string', () => {
  const rows = fromSqlite(exampleState())
  for (const slug of ['celeste', 'tunic']) {
    assert.deepEqual(rows.get(slug), { cover_sha256: null, cover_url: null, cover_source: null }, slug)
  }
})

test('cover_source is never null while either other column is set', () => {
  for (const [slug, row] of fromSqlite(exampleState())) {
    if (row.cover_sha256 === null && row.cover_url === null) continue
    assert.notEqual(row.cover_source, null, slug)
  }
})

/**
 * 07-targets.md requires `csv`, `json` and `sqlite` to carry the same columns,
 * and 04-derived.md makes the SQLite schema the authority when they disagree.
 * Cheap to assert on values as well as names, and it is what stops the three
 * from drifting.
 */
test('sqlite, csv and json agree on the cover columns and on their values', () => {
  const state = exampleState()
  const target = targetContext()

  const columns = query(buildDatabase(state), (db) =>
    (db.prepare("SELECT name FROM pragma_table_info('games')").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  )
  assert.deepEqual(columns.slice(-3), [...COLUMNS], 'the schema no longer ends `games` with the cover columns')

  const file = csv.plan(state, target).find((planned) => planned.path.endsWith('games.csv'))
  assert.notEqual(file, undefined)
  const header = String(file?.content).split('\n')[0]?.split(',') ?? []
  assert.deepEqual(header.slice(-3), [...COLUMNS])

  const payload = JSON.parse(String(json.plan(state, target)[0]?.content)) as {
    games: Record<string, unknown>[]
  }
  assert.deepEqual(Object.keys(payload.games[0]!).slice(-3), [...COLUMNS])

  // CSV has no nulls: an absent value is an empty field, which is what the two
  // representations are compared through rather than around.
  const text = (value: unknown): string => (value === null ? '' : String(value))
  const bySlug = fromSqlite(state)
  const fromCsv = new Map(parseCsv(String(file?.content)).map((row) => [row['slug']!, row]))

  assert.equal(bySlug.size, payload.games.length)
  assert.equal(bySlug.size, fromCsv.size)
  for (const game of payload.games) {
    const slug = String(game['slug'])
    const database = bySlug.get(slug)
    const spreadsheet = fromCsv.get(slug)
    assert.notEqual(database, undefined, slug)
    assert.notEqual(spreadsheet, undefined, slug)
    for (const column of COLUMNS) {
      assert.equal(game[column] ?? null, database?.[column] ?? null, `${slug}.${column} (json vs sqlite)`)
      assert.equal(spreadsheet?.[column], text(database?.[column] ?? null), `${slug}.${column} (csv vs sqlite)`)
    }
  }
})

/**
 * The fixture cannot reach a cover that is neither of the two sources, so this
 * is the one case built from events directly: `game.cover` with `source`
 * absent folds to `provider` (fold.ts), and the columns follow rather than
 * inventing a third value.
 */
test('a cover event with no source recorded emits provider, not null', () => {
  const state = fold(
    [
      event('game.create', { game_id: 'G1', slug: 'x', title: 'X' }),
      event('game.cover', { game_id: 'G1', url: 'https://example/art.jpg' }),
    ],
    context,
  )
  assert.deepEqual(fromSqlite(state).get('x'), {
    cover_sha256: null,
    cover_url: 'https://example/art.jpg',
    cover_source: 'provider',
  })
})
