/**
 * The target registry, the manifest and ownership (docs/spec/07-targets.md).
 *
 * Removal is the only destructive thing the build does, so most of what is
 * asserted here is what it refuses to remove.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { appendEvents, readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext, vaultPath, type Vault } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { build, claimPaths, type BuildResult } from '../src/targets/build.ts'
import { readManifest, serializeManifest } from '../src/targets/manifest.ts'
import type { PlannedFile } from '../src/targets/types.ts'
import { event, tempDir } from './helpers.ts'

function vault(targets?: string[]): string {
  const root = join(tempDir('gamereg-targets-'), 'vault')
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

function rebuild(root: string, only?: string[]): BuildResult {
  const opened = openVault(root)
  const state = fold(readEvents(opened.eventsFile), timeContext(opened))
  return build(opened, state, translator('en'), only === undefined ? {} : { only })
}

function game(gameId: string, slug: string, title: string): ReturnType<typeof event> {
  return event('game.create', { game_id: gameId, slug, title, genres: [], platforms: [], providers: {}, aliases: [] })
}

test('a rename moves the note, and ownership removes the one left behind', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)
  assert.equal(existsSync(join(root, 'games', 'sabotage.md')), true)

  record(root, event('game.rename', { game_id: '01K5A00000000000000000GAMA', slug: 'sea-of-stars', title: 'Sea of Stars' }))
  const second = rebuild(root)

  assert.deepEqual(second.removed, ['games/sabotage.md'])
  assert.equal(existsSync(join(root, 'games', 'sabotage.md')), false)
  assert.equal(existsSync(join(root, 'games', 'sea-of-stars.md')), true)
})

test('a missing manifest is not an error: everything is written and nothing is removed', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  record(root, event('game.rename', { game_id: '01K5A00000000000000000GAMA', slug: 'sea-of-stars' }))
  rmSync(join(root, '.gamereg', 'manifest.json'))
  const second = rebuild(root)

  // Ownership was never reconstructed by guessing from the filename.
  assert.deepEqual(second.removed, [])
  assert.equal(existsSync(join(root, 'games', 'sabotage.md')), true)
  // The new manifest claims what this build planned, and nothing it inherited.
  const manifest = readManifest(openVault(root).manifestFile)
  assert.deepEqual(manifest?.targets['obsidian']?.files.includes('games/sabotage.md'), false)

  // The orphan stays an orphan, for doctor to report. The build never guesses.
  assert.deepEqual(rebuild(root).removed, [])
  assert.equal(existsSync(join(root, 'games', 'sabotage.md')), true)
})

test('a file absent from the manifest is never removed, whatever it looks like', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  const stray = join(root, 'games', 'written-by-hand.md')
  writeFileSync(stray, '<!-- gamereg:begin block=header -->\n<!-- gamereg:end block=header -->\n')
  const second = rebuild(root)

  assert.deepEqual(second.removed, [])
  assert.equal(existsSync(stray), true)
})

test('the argument narrows a build; a target the vault does not declare is refused', () => {
  const root = vault(['obsidian'])
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  assert.throws(() => rebuild(root, ['csv']), /error\.target_not_declared/)
})

test('two targets planning the same path is a hard error, caught before any write', () => {
  const opened = openVault(vault())
  const file = (path: string): PlannedFile => ({ path, content: '', policy: 'replace' })
  const plans = new Map([
    ['obsidian', [file('Games.md')]],
    ['csv', [file('Games.md')]],
  ] as [never, PlannedFile[]][])

  assert.throws(() => claimPaths(opened, plans), /error\.target_conflict/)
})

test('a target may not plan a path outside the vault', () => {
  const opened: Vault = openVault(vault())
  assert.throws(() => vaultPath(opened, '../escaped.md'), /error\.outside_vault/)
  assert.throws(() => vaultPath(opened, 'games/../../escaped.md'), /error\.outside_vault/)
  assert.equal(vaultPath(opened, 'games/ok.md'), join(opened.root, 'games', 'ok.md'))
})

test('the manifest is data: sorted keys, forward slashes, one trailing newline', () => {
  const text = serializeManifest({
    schema: 1,
    targets: {
      obsidian: { files: ['games/b.md', 'Games.md', 'games/a.md'], seeds: ['Games.base'] },
      csv: { files: ['data/runs.csv'], seeds: [] },
    },
  })

  assert.equal(text.endsWith('}\n'), true)
  assert.equal(text.includes('\r'), false)
  assert.equal(Object.keys(JSON.parse(text).targets).join(','), 'csv,obsidian')
  assert.deepEqual(JSON.parse(text).targets.obsidian.files, ['Games.md', 'games/a.md', 'games/b.md'])
  assert.equal('seeds' in JSON.parse(text).targets.csv, false)
})

test('an unreadable manifest is treated as a missing one', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)
  writeFileSync(join(root, '.gamereg', 'manifest.json'), 'not json at all')

  const second = rebuild(root)
  assert.deepEqual(second.removed, [])
  assert.equal(readFileSync(join(root, '.gamereg', 'manifest.json'), 'utf8').startsWith('{'), true)
})
