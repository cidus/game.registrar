/**
 * The verdict: prose filed against a run (docs/spec/01-model.md `run.verdict`).
 *
 * Who wrote it is not modelled, so nothing here asks. What matters is that the
 * text lands on the right run, that filing again replaces it, and that revoking
 * it removes it from the note instead of leaving it stale.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { fold } from '../src/core/fold.ts'
import { translator } from '../src/i18n/index.ts'
import { verdictBlock } from '../src/render/note.ts'
import { spliceBlocks } from '../src/render/markers.ts'
import { context, event, tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')
const bundle = translator('en')

function run(root: string, ...args: string[]): { status: number; json: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [MAIN, '--vault', root, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1' },
    input: '',
  })
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse((result.stdout ?? '').trim()) as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: result.status ?? 1, json }
}

function vault(): string {
  const root = join(tempDir('gamereg-verdict-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo' }),
  )
  return root
}

function played(root: string): void {
  run(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  run(root, 'finish', 'celeste', '--rating', '9', '--at', '2026-05-03 22:00')
}

test('a verdict is filed from the command line, with no model anywhere near it', () => {
  const root = vault()
  played(root)

  const filed = run(root, 'verdict', 'celeste', '-m', 'Hard in the way I wanted it to be.')
  assert.equal(filed.status, 0)
  assert.equal(filed.json['action'], 'run.verdict')
  assert.equal((filed.json['result'] as { replaced: boolean }).replaced, false)

  run(root, 'build')
  const note = readFileSync(join(root, 'games', 'celeste.md'), 'utf8')
  assert.match(note, /## Verdict\n\n<!-- gamereg:begin block=verdict -->\nHard in the way I wanted it to be\./)
})

test('the text can arrive from a file or from stdin', () => {
  const root = vault()
  played(root)

  const file = join(root, 'review.md')
  writeFileSync(file, 'Written elsewhere, filed here.\n')
  assert.equal(run(root, 'verdict', 'celeste', '--text', file).status, 0)

  const piped = spawnSync(process.execPath, [MAIN, '--vault', root, '--json', 'verdict', 'celeste', '--text', '-'], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1' },
    input: 'Piped in from somewhere else.\n',
  })
  assert.equal(piped.status, 0)

  run(root, 'build')
  const note = readFileSync(join(root, 'games', 'celeste.md'), 'utf8')
  assert.match(note, /Piped in from somewhere else\./)
  assert.equal(note.includes('Written elsewhere'), false)
})

test('filing again replaces the verdict, and the earlier text stays in the log', () => {
  const root = vault()
  played(root)
  run(root, 'verdict', 'celeste', '-m', 'First thoughts.')

  const second = run(root, 'verdict', 'celeste', '-m', 'Second thoughts.')
  assert.equal((second.json['result'] as { replaced: boolean }).replaced, true)

  const log = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
  assert.match(log, /First thoughts\./)
  assert.match(log, /Second thoughts\./)

  run(root, 'build')
  const note = readFileSync(join(root, 'games', 'celeste.md'), 'utf8')
  assert.equal(note.includes('First thoughts.'), false)
  assert.match(note, /Second thoughts\./)
})

test('revoking a verdict empties the block instead of leaving it stale', () => {
  const root = vault()
  played(root)
  const filed = run(root, 'verdict', 'celeste', '-m', 'Withdrawn later.')
  run(root, 'build')

  run(root, 'revoke', (filed.json['events'] as string[])[0]!, '--reason', 'not what I meant')
  run(root, 'build')

  const note = readFileSync(join(root, 'games', 'celeste.md'), 'utf8')
  assert.equal(note.includes('Withdrawn later.'), false)
  assert.match(note, /<!-- gamereg:begin block=verdict -->\n<!-- gamereg:end block=verdict -->/)
})

test('a note with no verdict does not carry an empty heading', () => {
  const root = vault()
  played(root)
  run(root, 'build')

  const note = readFileSync(join(root, 'games', 'celeste.md'), 'utf8')
  assert.equal(note.includes('## Verdict'), false)
  assert.equal(note.includes('block=verdict'), false)
})

test('with no text anywhere, the command says how to provide it', () => {
  const root = vault()
  played(root)

  const missing = run(root, 'verdict', 'celeste')
  assert.equal(missing.status, 2)
  assert.match(String(missing.json['message']), /-m/)
})

test('the verdict lands on the run that ended, not on the replay under way', () => {
  const root = vault()
  played(root)
  const replay = run(root, 'start', 'celeste', '--replay', '--at', '2027-01-01 20:00')
  const replayRun = (replay.json['result'] as { run_id: string }).run_id

  const filed = run(root, 'verdict', 'celeste', '-m', 'About the first time through.')
  assert.notEqual((filed.json['result'] as { run_id: string }).run_id, replayRun)

  const named = run(root, 'verdict', 'celeste', '--run', replayRun, '-m', 'About the replay.')
  assert.equal((named.json['result'] as { run_id: string }).run_id, replayRun)
})

test('two runs with verdicts are rendered separately, each under its period', () => {
  const state = fold(
    [
      event('game.create', { game_id: 'G1', slug: 'celeste', title: 'Celeste' }),
      event('run.open', { run_id: 'R1', game_id: 'G1', platform: 'Switch', started_on: '2026-01-01' }),
      event('run.close', { run_id: 'R1', ended_on: '2026-02-01', outcome: 'finished' }),
      event('run.verdict', { run_id: 'R1', text: 'The first time.' }),
      event('run.open', { run_id: 'R2', game_id: 'G1', platform: 'PC', started_on: '2027-01-01', replay: true }),
      event('run.verdict', { run_id: 'R2', text: 'The second time.' }),
    ],
    context,
  )

  const block = verdictBlock(state.gamesById.get('G1')!, bundle)
  assert.match(block, /\*2026-01-01 to 2026-02-01\*\n\nThe first time\./)
  assert.match(block, /\*since 2027-01-01\*\n\nThe second time\./)
})

test('an unresolved verdict block is still emptied when it exists', () => {
  const source = [
    '## Verdict',
    '',
    '<!-- gamereg:begin block=verdict -->',
    'stale text',
    '<!-- gamereg:end block=verdict -->',
    '',
  ].join('\n')

  const output = spliceBlocks(source, [{ block: 'verdict', content: '', appendWhenMissing: false }], 'note.md')
  assert.equal(output.includes('stale text'), false)
  assert.match(output, /<!-- gamereg:begin block=verdict -->\n<!-- gamereg:end block=verdict -->/)
})
