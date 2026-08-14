/**
 * `gamereg doctor`'s checks on derived artifacts, as opposed to the log
 * (docs/spec/02-cli.md, docs/spec/04-derived.md).
 *
 * The build never touches what it does not own; these tests are about making
 * sure the user hears about it instead.
 */
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { appendEvents, readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { auditArtifacts } from '../src/targets/audit.ts'
import { build } from '../src/targets/build.ts'
import { event, tempDir } from './helpers.ts'

function vault(targets?: string[]): string {
  const root = join(tempDir('gamereg-audit-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({
      locale: 'en',
      timezone: 'America/Sao_Paulo',
      ...(targets === undefined ? {} : { build: { targets } }),
    }),
  )
  return root
}

function record(root: string, ...events: ReturnType<typeof event>[]): void {
  appendEvents(join(root, 'data', 'events.jsonl'), events)
}

function game(gameId: string, slug: string, title: string): ReturnType<typeof event> {
  return event('game.create', { game_id: gameId, slug, title, genres: [], platforms: [], providers: {}, aliases: [] })
}

function run(runId: string, gameId: string): ReturnType<typeof event> {
  return event('run.import', {
    run_id: runId,
    game_id: gameId,
    platform: 'Switch',
    form: 'digital',
    mode: 'solo',
    started_on: '2026-05-03',
    ended_on: '2026-05-03',
    date_precision: 'day',
    outcome: 'finished',
    hours: 2,
    replay: false,
  })
}

function rebuild(root: string): void {
  const opened = openVault(root)
  const state = fold(readEvents(opened.eventsFile), timeContext(opened))
  build(opened, state, translator('en'))
}

function audit(root: string): { key: string; params: Record<string, unknown> }[] {
  const opened = openVault(root)
  const state = fold(readEvents(opened.eventsFile), timeContext(opened))
  return auditArtifacts(opened, state, translator('en')).map((problem) => ({
    key: problem.key,
    params: problem.params,
  }))
}

test('a freshly built vault is clean', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)
  assert.deepEqual(audit(root), [])
})

test('a block this version does not write is reported, and stays reported after a build', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  const file = join(root, 'games', 'sabotage.md')
  appendFileSync(file, '\n<!-- gamereg:begin block=achievements -->\nfuture content\n<!-- gamereg:end block=achievements -->\n')

  const found = audit(root)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.key, 'doctor.unknown_block')
  assert.deepEqual(found[0]?.params, { file: 'games/sabotage.md', block: 'achievements' })

  // The build never removes what it does not recognize.
  rebuild(root)
  const stillThere = audit(root)
  assert.equal(stillThere.length, 1)
  assert.equal(stillThere[0]?.key, 'doctor.unknown_block')
})

test('prose typed into a run note is reported before the next build loses it', () => {
  const root = vault()
  record(
    root,
    game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'),
    run('01K5A00000000000000000RUNA', '01K5A00000000000000000GAMA'),
  )
  rebuild(root)

  const file = join(root, 'runs', 'sabotage-2026-05-03.md')
  appendFileSync(file, '\nTyped in by hand.\n')

  const found = audit(root)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.key, 'doctor.run_note_prose')
  assert.equal(found[0]?.params['file'], 'runs/sabotage-2026-05-03.md')
})

test('a file that looks generated but is owned by no target is an orphan', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  writeFileSync(
    join(root, 'games', 'ghost.md'),
    '<!-- gamereg:begin block=header -->\nleftover\n<!-- gamereg:end block=header -->\n',
  )

  const found = audit(root)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.key, 'doctor.orphan_artifact')
  assert.equal(found[0]?.params['file'], 'games/ghost.md')
})

test('a hand-written note with no markers at all is not an orphan', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  writeFileSync(join(root, 'games', 'scratch.md'), '# Just some notes\n\nNothing generated here.\n')

  assert.deepEqual(audit(root), [])
})

test('a target that cannot plan — two games sharing a slug — fails on its own, and is reported', () => {
  const root = vault()
  record(
    root,
    game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'),
    game('01K5A00000000000000000GAMB', 'sabotage', 'Sabotage Redux'),
  )

  const found = audit(root)
  assert.equal(found.length, 1)
  assert.equal(found[0]?.key, 'doctor.target_failed')
  assert.equal(found[0]?.params['target'], 'obsidian')
  assert.match(String(found[0]?.params['message']), /sabotage/)
})
