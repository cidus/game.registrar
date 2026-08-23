/**
 * The target registry, the manifest and ownership (docs/spec/07-targets.md).
 *
 * Removal is the only destructive thing the build does, so most of what is
 * asserted here is what it refuses to remove.
 */
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { appendEvents, readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext, vaultPath, type Vault } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { BUILD_TARGET, TARGET_PHASE, UNBUILT_TARGETS } from '../src/core/vocab.ts'
import { build, claimPaths, type BuildResult } from '../src/targets/build.ts'
import { allTargets } from '../src/targets/registry.ts'
import { readManifest, serializeManifest } from '../src/targets/manifest.ts'
import { mirrorAssets } from '../src/targets/obsidian.ts'
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

test('the vocabulary, the registry and the unbuilt list account for every target once', () => {
  // `core/` may not depend on `targets/`, so `UNBUILT_TARGETS` is written by
  // hand next to the vocabulary. This is what stops it from rotting: a target
  // that lands must leave the list, and one that is named must be in exactly
  // one of the two places.
  const built = allTargets().map((target) => target.name)
  assert.deepEqual([...built, ...UNBUILT_TARGETS].sort(), [...BUILD_TARGET].sort())
  for (const name of built) assert.equal(UNBUILT_TARGETS.includes(name), false, name)
})

test('a target declares the same phase the vocabulary does', () => {
  for (const target of allTargets()) assert.equal(target.since, TARGET_PHASE[target.name], target.name)
})

test('a rename moves the note, and ownership removes the one left behind', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)
  assert.equal(existsSync(join(root, 'obsidian', 'games', 'sabotage.md')), true)

  record(root, event('game.rename', { game_id: '01K5A00000000000000000GAMA', slug: 'sea-of-stars', title: 'Sea of Stars' }))
  const second = rebuild(root)

  assert.deepEqual(second.removed, ['obsidian/games/sabotage.md'])
  assert.equal(existsSync(join(root, 'obsidian', 'games', 'sabotage.md')), false)
  assert.equal(existsSync(join(root, 'obsidian', 'games', 'sea-of-stars.md')), true)
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
  assert.equal(existsSync(join(root, 'obsidian', 'games', 'sabotage.md')), true)
  // The new manifest claims what this build planned, and nothing it inherited.
  const manifest = readManifest(openVault(root).manifestFile)
  assert.deepEqual(manifest?.targets['obsidian']?.files.includes('obsidian/games/sabotage.md'), false)

  // The orphan stays an orphan, for doctor to report. The build never guesses.
  assert.deepEqual(rebuild(root).removed, [])
  assert.equal(existsSync(join(root, 'obsidian', 'games', 'sabotage.md')), true)
})

test('a file absent from the manifest is never removed, whatever it looks like', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  const stray = join(root, 'obsidian', 'games', 'written-by-hand.md')
  writeFileSync(stray, '<!-- gamereg:begin block=header -->\n<!-- gamereg:end block=header -->\n')
  const second = rebuild(root)

  assert.deepEqual(second.removed, [])
  assert.equal(existsSync(stray), true)
})

test('disabling a target cleans up after itself, and moves nothing else', () => {
  const root = vault(['obsidian', 'csv'])
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)
  assert.equal(existsSync(join(root, 'data', 'runs.csv')), true)

  const note = readFileSync(join(root, 'obsidian', 'games', 'sabotage.md'), 'utf8')
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', build: { targets: ['obsidian'] } }),
  )
  const second = rebuild(root)

  assert.deepEqual(second.removed.sort(), ['data/games.csv', 'data/runs.csv', 'data/sessions.csv'])
  assert.equal(existsSync(join(root, 'data', 'runs.csv')), false)
  assert.equal(existsSync(join(root, 'data', 'events.jsonl')), true)
  assert.equal(readFileSync(join(root, 'obsidian', 'games', 'sabotage.md'), 'utf8'), note)
  assert.equal(readManifest(openVault(root).manifestFile)?.targets['csv'], undefined)
})

test('a narrowed build says nothing about the targets it was not asked to build', () => {
  const root = vault(['obsidian', 'csv'])
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  const narrowed = rebuild(root, ['csv'])
  assert.deepEqual(narrowed.removed, [])
  assert.equal(existsSync(join(root, 'obsidian', 'games', 'sabotage.md')), true)
  assert.notEqual(readManifest(openVault(root).manifestFile)?.targets['obsidian'], undefined)
})

test('a seed is written once and is the user\'s from then on', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  const first = rebuild(root)
  assert.equal(first.written.includes('obsidian/Game Database.base'), true)

  const base = join(root, 'obsidian', 'Game Database.base')
  writeFileSync(base, 'views: []\n# reordered a column through the UI\n')
  const second = rebuild(root)

  assert.equal(second.written.includes('obsidian/Game Database.base'), false)
  assert.match(readFileSync(base, 'utf8'), /reordered a column/)
})

test('--force is the only path that overwrites a seed', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  const base = join(root, 'obsidian', 'Game Database.base')
  writeFileSync(base, 'views: []\n')

  const opened = openVault(root)
  const state = fold(readEvents(opened.eventsFile), timeContext(opened))
  build(opened, state, translator('en'), { force: true })

  assert.equal(readFileSync(base, 'utf8').includes('views: []\n'), false)
  assert.match(readFileSync(base, 'utf8'), /file\.inFolder\("runs"\)/)
})

test('a seed is never removed, not even when its target is gone', () => {
  const root = vault(['obsidian'])
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', build: { targets: ['csv'] } }),
  )
  const second = rebuild(root)

  assert.equal(second.removed.includes('obsidian/Game Database.base'), false)
  assert.equal(existsSync(join(root, 'obsidian', 'Game Database.base')), true)
  // The game notes it did own are gone, so this is not simply a build that
  // forgot to clean.
  assert.equal(existsSync(join(root, 'obsidian', 'games', 'sabotage.md')), false)
  assert.deepEqual(readManifest(openVault(root).manifestFile)?.targets['obsidian'], {
    files: [],
    seeds: ['obsidian/Game Database.base'],
  })
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
    ['obsidian', [file('obsidian/Game List.md')]],
    ['csv', [file('obsidian/Game List.md')]],
  ] as [never, PlannedFile[]][])

  assert.throws(() => claimPaths(opened, plans), /error\.target_conflict/)
})

test('a target may not plan a path outside the vault', () => {
  const opened: Vault = openVault(vault())
  assert.throws(() => vaultPath(opened, '../escaped.md'), /error\.outside_vault/)
  assert.throws(() => vaultPath(opened, 'obsidian/games/../../../escaped.md'), /error\.outside_vault/)
  assert.equal(vaultPath(opened, 'obsidian/games/ok.md'), join(opened.root, 'obsidian', 'games', 'ok.md'))
})

test('the manifest is data: sorted keys, forward slashes, one trailing newline', () => {
  const text = serializeManifest({
    schema: 1,
    targets: {
      obsidian: {
        files: ['obsidian/games/b.md', 'obsidian/Game List.md', 'obsidian/games/a.md'],
        seeds: ['obsidian/Game Database.base'],
      },
      csv: { files: ['data/runs.csv'], seeds: [] },
    },
  })

  assert.equal(text.endsWith('}\n'), true)
  assert.equal(text.includes('\r'), false)
  assert.equal(Object.keys(JSON.parse(text).targets).join(','), 'csv,obsidian')
  assert.deepEqual(JSON.parse(text).targets.obsidian.files, [
    'obsidian/Game List.md',
    'obsidian/games/a.md',
    'obsidian/games/b.md',
  ])
  assert.equal('seeds' in JSON.parse(text).targets.csv, false)
})

/**
 * Obsidian on Linux does not traverse a symlink, so the `obsidian/assets ->
 * ../assets` link earlier versions created left every embed in the vault
 * showing nothing. A hardlink is the file under a second name, with no link to
 * refuse.
 */
test('a build mirrors assets into obsidian/ as hardlinks, so embeds resolve on any platform', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  const sha = `${'a'.repeat(64)}`
  mkdirSync(join(root, 'assets', sha.slice(0, 2)), { recursive: true })
  writeFileSync(join(root, 'assets', sha.slice(0, 2), `${sha}.webp`), 'pretend webp')
  rebuild(root)

  const mirrored = join(root, 'obsidian', 'assets', sha.slice(0, 2), `${sha}.webp`)
  const stat = lstatSync(mirrored)
  assert.equal(stat.isSymbolicLink(), false, 'a symlink is exactly what Obsidian will not follow')
  assert.equal(stat.isFile(), true)
  // One inode under two names: the mirror costs no disk, and the bytes cannot
  // drift from the original because there is only one copy of them.
  assert.equal(stat.ino, lstatSync(join(root, 'assets', sha.slice(0, 2), `${sha}.webp`)).ino)

  // Idempotent: a name that exists is already the right bytes, being
  // content-addressed, so a second build leaves it alone.
  rebuild(root)
  assert.equal(lstatSync(mirrored).ino, stat.ino)
})

test('the mirror replaces the symlink an earlier version left behind', () => {
  const root = vault()
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  const sha = `${'b'.repeat(64)}`
  mkdirSync(join(root, 'assets', sha.slice(0, 2)), { recursive: true })
  writeFileSync(join(root, 'assets', sha.slice(0, 2), `${sha}.webp`), 'pretend webp')
  mkdirSync(join(root, 'obsidian'), { recursive: true })
  symlinkSync('../assets', join(root, 'obsidian', 'assets'), 'dir')

  rebuild(root)

  assert.equal(lstatSync(join(root, 'obsidian', 'assets')).isDirectory(), true)
  assert.equal(lstatSync(join(root, 'obsidian', 'assets', sha.slice(0, 2), `${sha}.webp`)).isFile(), true)
})

test('mirrorAssets never clobbers something a user put at that path', () => {
  const root = vault()
  mkdirSync(join(root, 'assets', 'aa'), { recursive: true })
  writeFileSync(join(root, 'assets', 'aa', 'aa.webp'), 'pretend webp')
  mkdirSync(join(root, 'obsidian'), { recursive: true })
  writeFileSync(join(root, 'obsidian', 'assets'), 'not a directory')

  mirrorAssets(openVault(root))

  assert.equal(readFileSync(join(root, 'obsidian', 'assets'), 'utf8'), 'not a directory')

  // A symlink pointing somewhere else is someone's own arrangement too.
  rmSync(join(root, 'obsidian', 'assets'))
  symlinkSync('../elsewhere', join(root, 'obsidian', 'assets'), 'dir')
  mirrorAssets(openVault(root))
  assert.equal(readlinkSync(join(root, 'obsidian', 'assets')), '../elsewhere')
})

test('a build with obsidian disabled never mirrors anything', () => {
  const root = vault(['csv'])
  record(root, game('01K5A00000000000000000GAMA', 'sabotage', 'Sabotage'))
  rebuild(root)

  assert.equal(existsSync(join(root, 'obsidian')), false)
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
