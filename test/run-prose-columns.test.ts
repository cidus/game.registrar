/**
 * A run's prose as columns on `runs` (docs/spec/04-derived.md "SQLite",
 * [0109](../docs/decisions/0109-run-prose-reaches-the-derived-artifacts.md)).
 *
 * `runs.note` and `runs.verdict` are the two values a run carries that are
 * neither an enum nor a number. `verdict` is the interesting one: it is folded
 * with last-wins semantics, it can be revoked back to nothing, and it is the
 * first column in any derived artifact whose real data contains a line break —
 * which is the case the CSV encoder has always handled and no golden had ever
 * exercised.
 *
 * Driven off `example-vault/`, which now carries every shape: a verdict filed
 * once and multi-line, a verdict filed twice, a verdict filed and revoked, and
 * runs with neither piece of prose. A fixture and a unit test cannot then drift
 * apart about what the emitted values are.
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

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

const COLUMNS = ['note', 'verdict'] as const

/** The fixture's runs, by the slug of the game they belong to — one run each. */
const HOLLOW_KNIGHT = '01K5A00000000000000000RUN1'
const CHRONO_TRIGGER = '01K5A00000000000000000RUN2'
const OUTER_WILDS = '01K5A00000000000000000RUN3'
const CELESTE = '01K5A00000000000000000RUN4'
const TUNIC = '01K5A00000000000000000RUN5'

type ProseRow = { note: string | null; verdict: string | null }

function exampleState(): VaultState {
  const vault = openVault(EXAMPLE)
  return fold(readEvents(vault.eventsFile), timeContext(vault))
}

function targetContext(): { config: typeof DEFAULT_CONFIG; bundle: ReturnType<typeof translator> } {
  return { config: structuredClone(DEFAULT_CONFIG), bundle: translator('en') }
}

/** `node:sqlite` reads only from a path, so the bytes are round-tripped through a throwaway file. */
function query<T>(bytes: Buffer, read: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'gamereg-run-prose-'))
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

/** The two columns per run id, as SQLite has them. */
function fromSqlite(state: VaultState): Map<string, ProseRow> {
  return query(buildDatabase(state), (db) => {
    const rows = db
      .prepare(`SELECT run_id, ${COLUMNS.join(', ')} FROM runs`)
      .all() as ({ run_id: string } & ProseRow)[]
    return new Map(rows.map((row) => [row.run_id, { note: row.note, verdict: row.verdict }]))
  })
}

function runsCsv(state: VaultState): string {
  const file = csv.plan(state, targetContext()).find((planned) => planned.path.endsWith('runs.csv'))
  assert.notEqual(file, undefined, 'the csv target no longer plans runs.csv')
  return String(file?.content)
}

test('a run that filed a verdict carries its text, and the note it closed with', () => {
  const rows = fromSqlite(exampleState())

  // Filed once, and the only prose on that run: `run.close` carried no note.
  assert.match(rows.get(HOLLOW_KNIGHT)?.verdict ?? '', /^Started as a curiosity/)
  assert.equal(rows.get(HOLLOW_KNIGHT)?.note, null)

  // A run imported with a note and no verdict of its own would be the reverse;
  // this one has both, so the two columns cannot be confused for each other.
  assert.equal(rows.get(CHRONO_TRIGGER)?.note, 'Filed from memory, fifteen years late.')
})

/**
 * "Filing again replaces the previous verdict; both stay in the file"
 * (01-model.md, `src/core/fold.ts`). The column holds the fold's answer, so the
 * later filing is the one that reaches it — and the earlier one is still in the
 * log, which the `events` table proves.
 */
test('a verdict filed twice reaches the column as the latest one, not the first', () => {
  const state = exampleState()
  const filings = [...state.eventsById.values()].filter(
    (event) => event.type === 'run.verdict' && event.data['run_id'] === CHRONO_TRIGGER,
  )
  assert.equal(filings.length, 2, 'the fixture no longer files a verdict twice for one run')

  const verdict = fromSqlite(state).get(CHRONO_TRIGGER)?.verdict
  assert.equal(verdict, filings[1]?.data['text'])
  assert.notEqual(verdict, filings[0]?.data['text'])
  assert.match(verdict ?? '', /^Replayed it over one long week/)
})

/**
 * A revoked verdict is not an empty verdict: the fold never applies the event,
 * so the run reads exactly as one that never filed a verdict at all. Nothing
 * downstream should be able to tell the two apart.
 */
test('a revoked verdict leaves the column null', () => {
  const state = exampleState()
  const revoked = [...state.eventsById.values()].find(
    (event) => event.type === 'run.verdict' && event.data['run_id'] === OUTER_WILDS,
  )
  assert.notEqual(revoked, undefined, 'the fixture no longer files a verdict that is then revoked')

  assert.equal(fromSqlite(state).get(OUTER_WILDS)?.verdict, null)
})

test('a run with neither piece of prose is two nulls, never an empty string', () => {
  const rows = fromSqlite(exampleState())
  for (const run of [CELESTE, TUNIC]) {
    assert.deepEqual(rows.get(run), { note: null, verdict: null }, run)
  }
})

/**
 * The test that earns the column. A verdict is the first field in any derived
 * artifact whose real data contains a line break, and `encodeCsv` quotes it —
 * so the file has more lines than it has rows, and a reader that splits on `\n`
 * is wrong about every row after the first verdict.
 */
test('a multi-line verdict is quoted, and costs runs.csv no extra row', () => {
  const state = exampleState()
  const text = runsCsv(state)

  const multiline = [...fromSqlite(state).values()].filter((row) => row.verdict?.includes('\n'))
  assert.ok(multiline.length > 0, 'the fixture no longer carries a verdict with a line break')

  const rows = parseCsv(text)
  assert.equal(rows.length, state.runsById.size)
  assert.ok(
    text.trim().split('\n').length > rows.length + 1,
    'a naive line split would have to gain lines for this test to mean anything',
  )

  for (const row of rows) {
    const verdict = row['verdict'] ?? ''
    if (!verdict.includes('\n')) continue
    // Quoted in the file, and identical to what SQLite holds once parsed.
    assert.ok(text.includes(`"${verdict.replace(/"/g, '""')}"`), 'the verdict is not quoted in the file')
    assert.equal(verdict, fromSqlite(state).get(row['run_id'] ?? '')?.verdict)
  }
})

/**
 * 07-targets.md requires `csv`, `json` and `sqlite` to carry the same columns,
 * and 04-derived.md makes the SQLite schema the authority when they disagree.
 */
test('sqlite, csv and json agree on the prose columns and on their values', () => {
  const state = exampleState()

  const columns = query(buildDatabase(state), (db) =>
    (db.prepare("SELECT name FROM pragma_table_info('runs')").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  )
  assert.deepEqual(columns.slice(-2), [...COLUMNS], 'the schema no longer ends `runs` with the prose columns')

  const header = runsCsv(state).split('\n')[0]?.split(',') ?? []
  assert.deepEqual(header.slice(-2), [...COLUMNS])

  const payload = JSON.parse(String(json.plan(state, targetContext())[0]?.content)) as {
    runs: Record<string, unknown>[]
  }
  assert.deepEqual(Object.keys(payload.runs[0]!).slice(-2), [...COLUMNS])

  // CSV has no nulls: an absent value is an empty field, which is what the two
  // representations are compared through rather than around.
  const text = (value: unknown): string => (value === null ? '' : String(value))
  const byRun = fromSqlite(state)
  const fromCsv = new Map(parseCsv(runsCsv(state)).map((row) => [row['run_id']!, row]))

  assert.equal(byRun.size, payload.runs.length)
  assert.equal(byRun.size, fromCsv.size)
  for (const run of payload.runs) {
    const id = String(run['run_id'])
    const database = byRun.get(id)
    const spreadsheet = fromCsv.get(id)
    assert.notEqual(database, undefined, id)
    assert.notEqual(spreadsheet, undefined, id)
    for (const column of COLUMNS) {
      assert.equal(run[column] ?? null, database?.[column] ?? null, `${id}.${column} (json vs sqlite)`)
      assert.equal(spreadsheet?.[column], text(database?.[column] ?? null), `${id}.${column} (csv vs sqlite)`)
    }
  }
})

/**
 * The gap that closes here: a consumer wanting the verdict had to pull it out
 * of a run note's markers, which couples it to whichever note-writing target
 * happens to be enabled (invariant 8).
 */
test('every verdict the fixture folds is readable without parsing a note', () => {
  const state = exampleState()
  const written = [...state.runsById.values()].filter((run) => run.verdict !== null)
  assert.ok(written.length > 1, 'the fixture no longer carries more than one verdict')

  const rows = fromSqlite(state)
  for (const run of written) {
    assert.equal(rows.get(run.run_id)?.verdict, run.verdict, run.run_id)
  }
})
