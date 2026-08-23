/**
 * `gamereg import` — end-to-end, through the real binary (docs/spec/02-cli.md).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

type Run = { status: number; json: Record<string, unknown>; stdout: string; stderr: string }

function vault(): string {
  const root = join(tempDir('gamereg-import-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', day_cutoff: '05:00' }),
  )
  return root
}

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

const CSV = [
  'Title,Finished,Started,Hours,Rating',
  'Chrono Trigger,2011-07,,30,10',
  'Hollow Knight,2026-08-12,2026-05-03,42.3,9',
  'Celeste,2026,,,',
].join('\n')

const MAPPING = { title: 'Title', ended: 'Finished', started: 'Started', hours: 'Hours', rating: 'Rating' }

function writeFixtures(root: string): { csv: string; mapping: string } {
  const csv = join(root, 'games.csv')
  const mapping = join(root, 'mapping.json')
  writeFileSync(csv, CSV)
  writeFileSync(mapping, JSON.stringify(MAPPING))
  return { csv, mapping }
}

test('imports one run.import per row', () => {
  const root = vault()
  const { csv, mapping } = writeFixtures(root)

  const run = gamereg(root, 'import', csv, '--mapping', mapping)
  assert.equal(run.status, 0, run.stdout)
  const imported = result(run)['imported'] as { row: number; title: string }[]
  assert.equal(imported.length, 3)
  assert.deepEqual(
    imported.map((entry) => entry.title),
    ['Chrono Trigger', 'Hollow Knight', 'Celeste'],
  )

  const log = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8').trim().split('\n')
  const runImports = log.filter((line) => (JSON.parse(line) as { type: string }).type === 'run.import')
  assert.equal(runImports.length, 3)
})

test('--dry-run computes everything and writes nothing', () => {
  const root = vault()
  const { csv, mapping } = writeFixtures(root)

  const run = gamereg(root, 'import', csv, '--mapping', mapping, '--dry-run')
  assert.equal(run.status, 0, run.stdout)
  assert.equal(run.json['dry_run'], true)
  assert.equal(existsSync(join(root, 'data', 'events.jsonl')), false)
})

test('date precision is inferred from the shape of the Finished column, per row', () => {
  const root = vault()
  const { csv, mapping } = writeFixtures(root)
  gamereg(root, 'import', csv, '--mapping', mapping)

  const log = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> })
    .filter((event) => event.type === 'run.import')

  const byTitle = new Map(log.map((event) => [String(event.data['game_id']), event.data]))
  const precisions = [...byTitle.values()].map((data) => data['date_precision'])
  assert.deepEqual(new Set(precisions), new Set(['month', 'day', 'year']))
})

test('a mapping missing the required "ended" column is a usage error', () => {
  const root = vault()
  const { csv } = writeFixtures(root)
  const mapping = join(root, 'bad-mapping.json')
  writeFileSync(mapping, JSON.stringify({ title: 'Title' }))

  const run = gamereg(root, 'import', csv, '--mapping', mapping)
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('a row with no value for a required field fails without stopping the others', () => {
  const root = vault()
  const csv = join(root, 'games.csv')
  const mapping = join(root, 'mapping.json')
  writeFileSync(csv, ['Title,Finished', 'Hollow Knight,2026-08-12', ',2026-07-20', 'Celeste,2026'].join('\n'))
  writeFileSync(mapping, JSON.stringify({ title: 'Title', ended: 'Finished' }))

  const run = gamereg(root, 'import', csv, '--mapping', mapping)
  assert.equal(run.status, 1)
  const payload = (run.json as Record<string, unknown>)['result'] as {
    imported: unknown[]
    failed: { row: number }[]
  }
  assert.equal(payload.imported.length, 2)
  assert.equal(payload.failed.length, 1)
  assert.equal(payload.failed[0]!.row, 3)

  // What succeeded is still committed, even though the command reports failure.
  const log = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8').trim().split('\n')
  const runImports = log.filter((line) => (JSON.parse(line) as { type: string }).type === 'run.import')
  assert.equal(runImports.length, 2)
})

test('an unreadable CSV file is a usage error', () => {
  const root = vault()
  const { mapping } = writeFixtures(root)
  const run = gamereg(root, 'import', join(root, 'nonexistent.csv'), '--mapping', mapping)
  assert.equal(run.status, 2)
})

function runImportEvents(root: string): Record<string, unknown>[] {
  return readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event['type'] === 'run.import')
    .map((event) => event['data'] as Record<string, unknown>)
}

test('every optional field reaches the folded state', () => {
  const root = vault()
  const csv = join(root, 'games.csv')
  const mapping = join(root, 'mapping.json')
  writeFileSync(
    csv,
    [
      'Title,Finished,Difficulty,Criteria,Outcome,Platform,Form,Mode,Note,Verdict',
      'Hollow Knight,2026-08-12,hard,credits,finished,PS5,digital,solo,Loved the art,Best metroidvania in years',
    ].join('\n'),
  )
  writeFileSync(
    mapping,
    JSON.stringify({
      title: 'Title',
      ended: 'Finished',
      difficulty: 'Difficulty',
      criteria: 'Criteria',
      outcome: 'Outcome',
      platform: 'Platform',
      form: 'Form',
      mode: 'Mode',
      note: 'Note',
      verdict: 'Verdict',
    }),
  )

  const run = gamereg(root, 'import', csv, '--mapping', mapping)
  assert.equal(run.status, 0, run.stdout)

  const [imported] = runImportEvents(root)
  assert.equal(imported!['difficulty'], 'hard')
  assert.equal(imported!['completion_criteria'], 'credits')
  assert.equal(imported!['outcome'], 'finished')
  assert.equal(imported!['platform'], 'PlayStation 5')
  assert.equal(imported!['form'], 'digital')
  assert.equal(imported!['mode'], 'solo')
  assert.equal(imported!['note'], 'Loved the art')

  const log = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; data: Record<string, unknown> })
  const verdict = log.find((event) => event.type === 'run.verdict')
  assert.ok(verdict, 'expected a run.verdict event')
  assert.equal(verdict!.data['text'], 'Best metroidvania in years')
  assert.equal(verdict!.data['run_id'], imported!['run_id'])
})

test('an empty optional cell leaves the field unset rather than failing the row', () => {
  const root = vault()
  const csv = join(root, 'games.csv')
  const mapping = join(root, 'mapping.json')
  writeFileSync(csv, ['Title,Finished,Note', 'Celeste,2026,'].join('\n'))
  writeFileSync(mapping, JSON.stringify({ title: 'Title', ended: 'Finished', note: 'Note' }))

  const run = gamereg(root, 'import', csv, '--mapping', mapping)
  assert.equal(run.status, 0, run.stdout)

  const [imported] = runImportEvents(root)
  assert.equal('note' in imported!, false)
})

test('an out-of-range rating fails its own row without stopping the others', () => {
  const root = vault()
  const csv = join(root, 'games.csv')
  const mapping = join(root, 'mapping.json')
  writeFileSync(
    csv,
    ['Title,Finished,Rating', 'Hollow Knight,2026-08-12,9', 'Celeste,2026,99'].join('\n'),
  )
  writeFileSync(mapping, JSON.stringify({ title: 'Title', ended: 'Finished', rating: 'Rating' }))

  const run = gamereg(root, 'import', csv, '--mapping', mapping)
  assert.equal(run.status, 1)
  const payload = result(run) as { imported: unknown[]; failed: { row: number; message: string }[] }
  assert.equal(payload.imported.length, 1)
  assert.equal(payload.failed.length, 1)
  assert.equal(payload.failed[0]!.row, 3)
})

test('an enum written in the user\'s own words fails its own row without stopping the others', () => {
  const root = vault()
  const csv = join(root, 'games.csv')
  const mapping = join(root, 'mapping.json')
  writeFileSync(
    csv,
    ['Title,Finished,Outcome', 'Hollow Knight,2026-08-12,finished', 'Celeste,2026,Zerado'].join('\n'),
  )
  writeFileSync(mapping, JSON.stringify({ title: 'Title', ended: 'Finished', outcome: 'Outcome' }))

  const run = gamereg(root, 'import', csv, '--mapping', mapping)
  assert.equal(run.status, 1)
  const payload = result(run) as { imported: unknown[]; failed: { row: number }[] }
  assert.equal(payload.imported.length, 1)
  assert.equal(payload.failed.length, 1)
  assert.equal(payload.failed[0]!.row, 3)
})

test('an unparseable "hours" fails its own row without stopping the others', () => {
  const root = vault()
  const csv = join(root, 'games.csv')
  const mapping = join(root, 'mapping.json')
  writeFileSync(
    csv,
    ['Title,Finished,Hours', 'Hollow Knight,2026-08-12,42.3', 'Celeste,2026,"12,5"'].join('\n'),
  )
  writeFileSync(mapping, JSON.stringify({ title: 'Title', ended: 'Finished', hours: 'Hours' }))

  const run = gamereg(root, 'import', csv, '--mapping', mapping)
  assert.equal(run.status, 1)
  const payload = result(run) as { imported: unknown[]; failed: { row: number; message: string }[] }
  assert.equal(payload.imported.length, 1)
  assert.equal(payload.failed.length, 1)
  assert.equal(payload.failed[0]!.row, 3)
  assert.match(payload.failed[0]!.message, /NaN/)
})
