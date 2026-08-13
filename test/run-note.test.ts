/**
 * One note per run (docs/spec/04-derived.md "Run note").
 *
 * The file exists to be a row, so what matters is that it is addressable — the
 * name carries the precision it was recorded at, it moves when the run's facts
 * move, and nothing survives inside it that the log does not say.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { appendEvents, readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { build, type BuildResult } from '../src/targets/build.ts'
import { event, tempDir } from './helpers.ts'

function vault(): string {
  const root = join(tempDir('gamereg-runs-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo' }),
  )
  return root
}

function record(root: string, ...events: ReturnType<typeof event>[]): void {
  appendEvents(join(root, 'data', 'events.jsonl'), events)
}

function rebuild(root: string): BuildResult {
  const opened = openVault(root)
  return build(opened, fold(readEvents(opened.eventsFile), timeContext(opened)), translator('en'))
}

const GAME = '01K5A00000000000000000GAMA'

function game(slug: string, title: string): ReturnType<typeof event> {
  return event('game.create', {
    game_id: GAME,
    slug,
    title,
    genres: [],
    platforms: [],
    providers: {},
    aliases: [],
  })
}

function imported(runId: string, startedOn: string, precision: string): ReturnType<typeof event> {
  return event('run.import', {
    run_id: runId,
    game_id: GAME,
    platform: 'SNES',
    form: 'physical',
    mode: 'solo',
    started_on: startedOn,
    ended_on: startedOn,
    date_precision: precision,
    outcome: 'finished',
    completion_criteria: 'credits',
    hours: 30,
    replay: false,
  })
}

test('the filename carries the precision the date was recorded at', () => {
  const root = vault()
  record(root, game('chrono-trigger', 'Chrono Trigger'), imported('01K5A0000000000000000RUNA', '2011-01-01', 'year'))
  rebuild(root)

  assert.equal(existsSync(join(root, 'runs', 'chrono-trigger-2011.md')), true)
  assert.equal(existsSync(join(root, 'runs', 'chrono-trigger-2011-01-01.md')), false)
})

test('two runs starting on the same date take -2, in ULID order', () => {
  const root = vault()
  record(
    root,
    game('chrono-trigger', 'Chrono Trigger'),
    imported('01K5A0000000000000000RUNB', '2011-01-01', 'year'),
    imported('01K5A0000000000000000RUNA', '2011-01-01', 'year'),
  )
  rebuild(root)

  const first = readFileSync(join(root, 'runs', 'chrono-trigger-2011.md'), 'utf8')
  const second = readFileSync(join(root, 'runs', 'chrono-trigger-2011-2.md'), 'utf8')
  assert.match(first, /gamereg_run_id: 01K5A0000000000000000RUNA/)
  assert.match(second, /gamereg_run_id: 01K5A0000000000000000RUNB/)
})

test('a run note is written whole: nothing typed into it survives', () => {
  const root = vault()
  record(root, game('chrono-trigger', 'Chrono Trigger'), imported('01K5A0000000000000000RUNA', '2011-01-01', 'day'))
  rebuild(root)

  const file = join(root, 'runs', 'chrono-trigger-2011-01-01.md')
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nTyped in by hand, about to be lost.\n`)
  rebuild(root)

  assert.equal(readFileSync(file, 'utf8').includes('Typed in by hand'), false)
})

test('amending the start date moves the note, and ownership removes the old one', () => {
  const root = vault()
  const run = imported('01K5A0000000000000000RUNA', '2011-01-01', 'day')
  record(root, game('chrono-trigger', 'Chrono Trigger'), run)
  rebuild(root)
  assert.equal(existsSync(join(root, 'runs', 'chrono-trigger-2011-01-01.md')), true)

  record(root, event('event.amend', { target: run.id, reason: 'it was July', patch: { started_on: '2011-07-14' } }))
  const second = rebuild(root)

  assert.deepEqual(second.removed, ['runs/chrono-trigger-2011-01-01.md'])
  assert.equal(existsSync(join(root, 'runs', 'chrono-trigger-2011-07-14.md')), true)
})

test('the game note carries the runs table and no session log', () => {
  const root = vault()
  record(root, game('chrono-trigger', 'Chrono Trigger'), imported('01K5A0000000000000000RUNA', '2011-01-01', 'year'))
  rebuild(root)

  const note = readFileSync(join(root, 'games', 'chrono-trigger.md'), 'utf8')
  assert.equal(note.includes('block=sessions'), false)
  assert.match(note, /block=runs/)
  assert.match(note, /\[\[chrono-trigger-2011\\\|2011\]\]/)

  // Aggregate, across runs: no per-run field is left on the game note.
  assert.match(note, /^runs: 1$/m)
  assert.match(note, /^first_started_on: 2011-01-01$/m)
  assert.equal(/^difficulty:/m.test(note), false)
  assert.equal(/^completion_criteria:/m.test(note), false)
})
