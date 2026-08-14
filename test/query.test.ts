/**
 * `gamereg query` — end-to-end, through the real binary (docs/spec/02-cli.md).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')
const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function builtVault(): string {
  const dir = join(tempDir('gamereg-query-'), 'vault')
  cpSync(EXAMPLE, dir, { recursive: true })
  rmSync(join(dir, '.gamereg'), { recursive: true, force: true })
  return dir
}

function emptyVault(): string {
  const root = join(tempDir('gamereg-query-empty-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'gamereg.config.json'), JSON.stringify({ locale: 'en' }))
  return root
}

type Run = { status: number; json: Record<string, unknown>; stdout: string; stderr: string }

function gamereg(root: string, ...args: string[]): Run {
  const result = spawnSync(process.execPath, [MAIN, '--vault', root, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1', NO_COLOR: '1' },
  })
  const stdout = result.stdout ?? ''
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(stdout.trim()) as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: result.status ?? 1, json, stdout, stderr: result.stderr ?? '' }
}

const result = (run: Run): Record<string, unknown> => run.json['result'] as Record<string, unknown>

test('a SELECT against the committed log.db returns rows', () => {
  const root = builtVault()
  const run = gamereg(root, 'query', 'SELECT COUNT(*) AS n FROM games')
  assert.equal(run.status, 0, run.stdout)
  const rows = result(run)['rows'] as { n: number }[]
  assert.equal(rows.length, 1)
  assert.ok(rows[0]!.n > 0)
})

test('a view is queryable like any table', () => {
  const root = builtVault()
  const run = gamereg(root, 'query', 'SELECT * FROM v_finished')
  assert.equal(run.status, 0, run.stdout)
  assert.ok((result(run)['rows'] as unknown[]).length >= 0)
})

test('a mutating statement is refused before it ever reaches sqlite', () => {
  const root = builtVault()
  const run = gamereg(root, 'query', "DELETE FROM games")
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('two statements separated by a semicolon are refused', () => {
  const root = builtVault()
  const run = gamereg(root, 'query', 'SELECT 1; DROP TABLE games;')
  assert.equal(run.status, 2)
})

test('a query against a vault with no data/log.db is a clear usage error', () => {
  const root = emptyVault()
  const run = gamereg(root, 'query', 'SELECT 1')
  assert.equal(run.status, 2)
  assert.match(String(run.json['message']), /build/)
})

test('a syntactically invalid SELECT fails at execution, not as a crash', () => {
  const root = builtVault()
  const run = gamereg(root, 'query', 'SELECT * FROM nonexistent_table')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('--schema reports every table and view with its columns', () => {
  const root = builtVault()
  const run = gamereg(root, 'query', '--schema')
  assert.equal(run.status, 0, run.stdout)
  assert.equal(run.json['action'], 'query.schema')

  const named = (relations: unknown): Map<string, string[]> =>
    new Map(
      (relations as { name: string; columns: { name: string }[] }[]).map((relation) => [
        relation.name,
        relation.columns.map((column) => column.name),
      ]),
    )

  const tables = named(result(run)['tables'])
  const views = named(result(run)['views'])

  for (const table of ['games', 'runs', 'sessions', 'breaks', 'aliases', 'events']) {
    assert.ok(tables.has(table), `missing table ${table}`)
  }
  assert.deepEqual(tables.get('breaks'), ['break_id', 'session_id', 'started_at', 'ended_at', 'minutes'])

  // A view's columns come from its SELECT list, which is exactly what a caller
  // writing SQL cannot guess from the table definitions.
  assert.ok(views.has('v_finished'))
  assert.ok(views.get('v_finished')?.includes('hours'))
  assert.ok(views.get('v_by_genre')?.includes('mean_rating'))
})

test('--schema is not a statement, and refuses to be given one', () => {
  const root = builtVault()
  const run = gamereg(root, 'query', 'SELECT 1', '--schema')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('query with neither a statement nor --schema says what is missing', () => {
  const root = builtVault()
  const run = gamereg(root, 'query')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('--schema needs the database like any other query does', () => {
  const root = emptyVault()
  const run = gamereg(root, 'query', '--schema')
  assert.equal(run.status, 2)
  assert.match(String(run.json['message']), /build/)
})
