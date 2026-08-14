/**
 * The `csv` target (docs/spec/07-targets.md).
 *
 * It is the cheapest exit door the vault has, which is the whole argument for
 * it: the tests below are mostly about it staying boring — RFC 4180 quoting, a
 * fixed sort order, and headers that are schema tokens rather than prose.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { build } from '../src/targets/build.ts'
import { encodeCsv } from '../src/targets/csv.ts'
import { tempDir } from './helpers.ts'
import { cpSync, rmSync } from 'node:fs'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function copyExample(): string {
  const dir = join(tempDir('gamereg-csv-'), 'vault')
  cpSync(EXAMPLE, dir, { recursive: true })
  rmSync(join(dir, '.gamereg'), { recursive: true, force: true })
  return dir
}

test('a field is quoted only when it has to be, and inner quotes are doubled', () => {
  const text = encodeCsv(
    ['a', 'b', 'c', 'd', 'e'],
    [['plain', 'has, comma', 'has "quotes"', 'has\nnewline', null]],
  )
  assert.equal(
    text,
    'a,b,c,d,e\nplain,"has, comma","has ""quotes""","has\nnewline",',
  )
})

test('booleans and nulls are written as tokens and emptiness, never as prose', () => {
  assert.equal(encodeCsv(['x'], [[true], [false], [null], [0]]), 'x\ntrue\nfalse\n\n0')
})

test('headers are schema tokens, and no locale touches them', () => {
  const root = copyExample()
  const vault = openVault(root)
  const state = fold(readEvents(vault.eventsFile), timeContext(vault))
  build(vault, state, translator('pt-BR'))

  assert.equal(
    readFileSync(join(root, 'data', 'runs.csv'), 'utf8').split('\n')[0],
    'run_id,game_id,platform,form,mode,started_on,ended_on,outcome,completion_criteria,rating,difficulty,minutes,hours_source,replay',
  )
  assert.equal(
    readFileSync(join(root, 'data', 'games.csv'), 'utf8').split('\n')[0],
    'game_id,slug,title,release_year,developer,publisher,status',
  )
  assert.equal(
    readFileSync(join(root, 'data', 'sessions.csv'), 'utf8').split('\n')[0],
    'session_id,run_id,started_at,ended_at,minutes,logical_day,note',
  )
})

test('sort order is fixed, not incidental', () => {
  const root = copyExample()
  const vault = openVault(root)
  build(vault, fold(readEvents(vault.eventsFile), timeContext(vault)), translator('en'))

  const column = (file: string, index: number): string[] =>
    readFileSync(join(root, 'data', file), 'utf8')
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[index] ?? '')

  assert.deepEqual(column('games.csv', 1), [
    'celeste',
    'chrono-trigger',
    'hollow-knight',
    'outer-wilds',
    'tunic',
  ])
  assert.deepEqual(column('runs.csv', 5), [
    '2011-01-01',
    '2026-05-03',
    '2026-06-01',
    '2026-07-20',
    '2026-08-15',
  ])
  assert.deepEqual(
    column('sessions.csv', 2),
    [
      '2026-05-03T20:00:00-03:00',
      '2026-05-06T22:00:00-03:00',
      '2026-06-01T14:00:00-03:00',
      '2026-07-20T21:00:00-03:00',
      '2026-08-12T20:14:00-03:00',
      '2026-08-15T20:00:00-03:00',
    ],
  )
})
