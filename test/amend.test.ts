/**
 * `amend` refuses a patch key the target event does not carry, and a run
 * exposes both of the event ids a correction can take.
 *
 * Two silent no-ops reached the live log before this existed: `rating` and
 * `difficulty` patched onto a `run.open`, which reads neither, and `minutes`
 * patched onto a `run.close`, which is derived state the fold computes and
 * never reads back. Both exited 0 and echoed the patch, so the caller — an
 * agent, here — reported to the user that a rating had been recorded when
 * nothing had. The log is append-only, so a misleading record cannot be taken
 * out again; the refusal has to happen at the boundary.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { EVENT_FIELDS, EVENT_TYPES, type EventType } from '../src/core/events.ts'
import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')
const SPEC = join(import.meta.dirname, '..', 'docs', 'spec', '01-model.md')
const EXAMPLE_LOG = join(import.meta.dirname, '..', 'example-vault', 'data', 'events.jsonl')

type Run = { status: number; json: Record<string, unknown> }

function vault(): string {
  const root = join(tempDir('gamereg-amend-'), 'vault')
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
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse((result.stdout ?? '').trim()) as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: result.status ?? 1, json }
}

const result = (run: Run): Record<string, unknown> => run.json['result'] as Record<string, unknown>

/** A run played and finished, so both of its event ids exist. */
function finishedRun(root: string): { open: string; close: string } {
  gamereg(root, 'start', 'Tetris', '--no-metadata')
  gamereg(root, 'finish', 'Tetris', '--criteria', 'credits')
  const runs = result(gamereg(root, 'status', 'Tetris'))['runs'] as Record<string, unknown>[]
  return { open: runs[0]!['run_open_event_id'] as string, close: runs[0]!['run_close_event_id'] as string }
}

test('a run carries the id of the event that closed it, and null while it is open', () => {
  const root = vault()
  gamereg(root, 'start', 'Tetris', '--no-metadata')

  const open = (result(gamereg(root, 'status', 'Tetris'))['runs'] as Record<string, unknown>[])[0]!
  assert.equal(open['run_close_event_id'], null, 'an open run has no closing event yet')

  gamereg(root, 'finish', 'Tetris', '--criteria', 'credits')
  const closed = (result(gamereg(root, 'status', 'Tetris'))['runs'] as Record<string, unknown>[])[0]!
  assert.equal(typeof closed['run_close_event_id'], 'string')
  assert.notEqual(closed['run_close_event_id'], closed['run_open_event_id'])
})

/**
 * `past` files one event carrying the opening *and* the closing fields, so the
 * two ids are deliberately equal rather than one of them being null — the rule
 * the agent follows ("closing fields take the closing id") then needs no
 * exception for a historical entry.
 */
test('an imported run is its own closing event', () => {
  const root = vault()
  gamereg(root, 'past', 'Chrono Trigger', '--ended', '2019-06-01', '--hours', '30', '--no-metadata')

  const run = (result(gamereg(root, 'status', 'Chrono Trigger'))['runs'] as Record<string, unknown>[])[0]!
  assert.equal(run['run_close_event_id'], run['run_open_event_id'])
})

test('amend refuses a field the target event does not carry', () => {
  const root = vault()
  const { open } = finishedRun(root)

  const run = gamereg(root, 'amend', open, '--set', 'rating=9', '--set', 'difficulty=normal', '--reason', 'x')
  assert.equal(run.status, 2, 'patching a closing field onto run.open must not succeed')
  assert.equal(run.json['ok'], false)

  const message = run.json['message'] as string
  assert.match(message, /rating/, 'the message must name the field that was refused')
  assert.match(message, /run\.open/, 'the message must name the event type that refused it')
  assert.match(message, /started_on/, "the message must list the type's actual fields")

  const before = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
  assert.ok(!before.includes('"event.amend"'), 'a refused amend must append nothing')
})

/**
 * The second no-op found in the live log. `minutes` and `hours_source` are
 * computed by the fold from sessions and the stated baseline (invariant 7), so
 * naming them in a patch is asking for state the log does not store.
 */
test('amend refuses derived state, which the fold computes and never reads back', () => {
  const root = vault()
  const { close } = finishedRun(root)

  for (const pair of ['minutes=1985', 'hours_source=mixed']) {
    const run = gamereg(root, 'amend', close, '--set', pair, '--reason', 'x')
    assert.equal(run.status, 2, `${pair} is derived state and must be refused`)
  }
})

test('amend accepts a field the target event does carry, and the fold reads it', () => {
  const root = vault()
  const { open, close } = finishedRun(root)

  assert.equal(gamereg(root, 'amend', close, '--set', 'rating=7', '--set', 'difficulty=easy', '--reason', 'x').status, 0)
  assert.equal(gamereg(root, 'amend', open, '--set', 'platform=PS5', '--reason', 'x').status, 0)

  const run = (result(gamereg(root, 'status', 'Tetris'))['runs'] as Record<string, unknown>[])[0]!
  assert.equal(run['rating'], 7)
  assert.equal(run['difficulty'], 'easy')
  assert.equal(run['platform'], 'PlayStation 5')
})

test('every event type has a field list', () => {
  assert.deepEqual(Object.keys(EVENT_FIELDS).sort(), [...EVENT_TYPES].sort())
})

/**
 * The spec's payload tables are the authority; `EVENT_FIELDS` is a second copy
 * and this is what keeps it from drifting. Only one direction is asserted: the
 * writers add fields the tables do not repeat for every row (`at`,
 * `attachments`, `date_precision`), and the log below covers that direction.
 */
test('every field the model spec names is in the table', () => {
  const spec = readFileSync(SPEC, 'utf8')
  let checked = 0

  for (const line of spec.split('\n')) {
    const row = /^\|\s*`([a-z]+\.[a-z]+)`\s*\|(.*)\|\s*$/.exec(line)
    if (row === null) continue
    const type = row[1] as EventType
    if (!(type in EVENT_FIELDS)) continue

    // The cell is a field list followed by prose: `game.enrich`'s says which
    // keys `fields{}` may hold, `game.rename`'s explains what the build does.
    // Only the list before the em dash, parentheticals dropped, is payload.
    const payload = row[2]!.split(' — ')[0]!.replace(/\([^)]*\)/g, '')
    const allowed: readonly string[] = EVENT_FIELDS[type]
    for (const match of payload.matchAll(/`([a-z_]+)[?{[]*`/g)) {
      const field = match[1]!
      assert.ok(allowed.includes(field), `01-model.md gives ${type} a \`${field}\` the table omits`)
      checked += 1
    }
  }

  assert.ok(checked > 40, `only ${checked} fields matched — the spec's tables changed shape`)
})

/**
 * The other direction, against a real corpus rather than prose: anything the
 * fixture log actually holds has to be amendable, or a legitimate correction
 * would be refused.
 */
test('every field the fixture log holds is in the table', () => {
  const lines = readFileSync(EXAMPLE_LOG, 'utf8').trim().split('\n')
  assert.ok(lines.length > 10)

  for (const line of lines) {
    const event = JSON.parse(line) as { type: EventType; data: Record<string, unknown> }
    const allowed: readonly string[] = EVENT_FIELDS[event.type]
    for (const field of Object.keys(event.data)) {
      assert.ok(allowed.includes(field), `example-vault holds a ${event.type} with \`${field}\`, which amend would refuse`)
    }
  }
})
