/**
 * Golden files. `example-vault/` holds a fictional log and the exact expected
 * output, hand-written prose included. Any change in rendering shows up here as
 * a diff, which is the single most valuable test in the suite.
 */
import assert from 'node:assert/strict'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { build, type BuildResult } from '../src/targets/build.ts'
import { ownedPaths, readManifest } from '../src/targets/manifest.ts'
import { findRegions } from '../src/render/markers.ts'
import { tempDir } from './helpers.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function copyExample(): string {
  const dir = join(tempDir('gamereg-golden-'), 'vault')
  cpSync(EXAMPLE, dir, { recursive: true })
  return dir
}

function rebuild(root: string): BuildResult {
  const vault = openVault(root)
  const state = fold(readEvents(vault.eventsFile), timeContext(vault))
  return build(vault, state, translator(vault.config.locale ?? 'en'))
}

/**
 * What the build claims to own. Hardcoding the list would only test that the
 * test agrees with itself; the manifest is where ownership actually lives.
 */
function derivedFiles(root: string): string[] {
  const vault = openVault(root)
  const manifest = readManifest(vault.manifestFile)
  assert.notEqual(manifest, null, 'the build left no manifest behind')
  return [...ownedPaths(manifest)].sort()
}

/** The committed fixtures, listed by building a throwaway copy of them. */
function goldenFiles(): string[] {
  const root = copyExample()
  rebuild(root)
  return derivedFiles(root)
}

test('building the example vault reproduces the committed output byte for byte', () => {
  const root = copyExample()
  rebuild(root)

  for (const file of derivedFiles(root)) {
    assert.equal(existsSync(join(EXAMPLE, file)), true, `${file} is not committed`)
    assert.equal(
      readFileSync(join(root, file), 'utf8'),
      readFileSync(join(EXAMPLE, file), 'utf8'),
      file,
    )
  }
})

test('a second build is byte-identical to the first, and removes nothing', () => {
  const root = copyExample()
  rebuild(root)
  const files = derivedFiles(root)
  const first = files.map((file) => readFileSync(join(root, file), 'utf8'))

  const second = rebuild(root)
  assert.deepEqual(second.removed, [])
  assert.deepEqual(second.written, [])
  assert.deepEqual(
    files.map((file) => readFileSync(join(root, file), 'utf8')),
    first,
  )
})

test('deleting every derived artifact and rebuilding loses only hand-written prose', () => {
  const golden = goldenFiles()
  const root = copyExample()
  for (const file of golden) rmSync(join(root, file), { force: true })
  rebuild(root)

  for (const file of golden.filter((name) => name.endsWith('.md'))) {
    const rebuilt = readFileSync(join(root, file), 'utf8')
    const committed = readFileSync(join(EXAMPLE, file), 'utf8')

    const regionsOf = (source: string): string[] =>
      findRegions(source, file).map((region) => `${region.block}:${source.slice(region.contentStart, region.contentEnd)}`)

    assert.deepEqual(regionsOf(rebuilt), regionsOf(committed), file)
  }

  // The frontmatter is regenerated too, so it must come back identical.
  const rebuilt = readFileSync(join(root, 'games', 'hollow-knight.md'), 'utf8')
  const committed = readFileSync(join(EXAMPLE, 'games', 'hollow-knight.md'), 'utf8')
  const frontmatter = (source: string): string => source.split('---')[1] ?? ''
  assert.equal(frontmatter(rebuilt), frontmatter(committed))
})

test('the fixture log is free of irregularities', () => {
  const vault = openVault(EXAMPLE)
  const state = fold(readEvents(vault.eventsFile), timeContext(vault))
  assert.deepEqual(state.problems, [])
})

test('the fixture exercises measured hours, stated hours and an open run', () => {
  const vault = openVault(EXAMPLE)
  const state = fold(readEvents(vault.eventsFile), timeContext(vault))
  const runs = state.games.flatMap((game) => game.runs)

  assert.equal(runs.some((run) => run.hours_source === 'stated'), true)
  assert.equal(runs.some((run) => run.open), true)
  assert.equal(runs.some((run) => run.outcome === 'abandoned'), true)
  // Hollow Knight: 150 + 210 + 178 minutes, breaks deducted both ways.
  assert.equal(state.gamesById.get('01K5A00000000000000000GAM1')?.total_minutes, 538)
  // Outer Wilds: the amended closing time is the one that counts.
  assert.equal(state.gamesById.get('01K5A00000000000000000GAM3')?.total_minutes, 90)
  // Celeste: the revoked session never happened.
  assert.equal(state.gamesById.get('01K5A00000000000000000GAM4')?.runs[0]?.sessions.length, 1)
})
