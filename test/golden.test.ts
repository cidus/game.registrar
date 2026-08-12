/**
 * Golden files. `example-vault/` holds a fictional log and the exact expected
 * output, hand-written prose included. Any change in rendering shows up here as
 * a diff, which is the single most valuable test in the suite.
 */
import assert from 'node:assert/strict'
import { cpSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { build } from '../src/render/build.ts'
import { findRegions } from '../src/render/markers.ts'
import { tempDir } from './helpers.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function copyExample(): string {
  const dir = join(tempDir('gamereg-golden-'), 'vault')
  cpSync(EXAMPLE, dir, { recursive: true })
  return dir
}

function rebuild(root: string): void {
  const vault = openVault(root)
  const state = fold(readEvents(vault.eventsFile), timeContext(vault))
  build(vault, state, translator(vault.config.locale ?? 'en'))
}

function derivedFiles(root: string): string[] {
  return ['Games.md', ...readdirSync(join(root, 'games')).sort().map((name) => join('games', name))]
}

test('building the example vault reproduces the committed output byte for byte', () => {
  const root = copyExample()
  rebuild(root)

  for (const file of derivedFiles(EXAMPLE)) {
    assert.equal(
      readFileSync(join(root, file), 'utf8'),
      readFileSync(join(EXAMPLE, file), 'utf8'),
      file,
    )
  }
})

test('a second build is byte-identical to the first', () => {
  const root = copyExample()
  rebuild(root)
  const first = derivedFiles(root).map((file) => readFileSync(join(root, file), 'utf8'))
  rebuild(root)
  const second = derivedFiles(root).map((file) => readFileSync(join(root, file), 'utf8'))
  assert.deepEqual(second, first)
})

test('deleting every derived artifact and rebuilding loses only hand-written prose', () => {
  const root = copyExample()
  rmSync(join(root, 'Games.md'))
  rmSync(join(root, 'games'), { recursive: true })
  rebuild(root)

  for (const file of derivedFiles(EXAMPLE)) {
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
