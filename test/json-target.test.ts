/**
 * The `json` target (docs/spec/07-targets.md). Exercised directly, in
 * addition to the golden coverage it gets through `gamereg build`.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { readEvents } from '../src/core/events.ts'
import { fold, type VaultState } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { json } from '../src/targets/json.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function exampleState(): VaultState {
  const vault = openVault(EXAMPLE)
  return fold(readEvents(vault.eventsFile), timeContext(vault))
}

function plan(): string {
  const vault = openVault(EXAMPLE)
  const planned = json.plan(exampleState(), { config: vault.config, bundle: translator('en') })
  assert.equal(planned.length, 1)
  assert.equal(planned[0]!.path, 'data/export.json')
  assert.equal(planned[0]!.policy, 'replace')
  assert.equal(typeof planned[0]!.content, 'string')
  return planned[0]!.content as string
}

test('the export carries schema, games, runs and sessions, in that shape', () => {
  const payload = JSON.parse(plan()) as Record<string, unknown>
  assert.equal(payload['schema'], 1)
  assert.ok(Array.isArray(payload['games']))
  assert.ok(Array.isArray(payload['runs']))
  assert.ok(Array.isArray(payload['sessions']))
})

test('games are sorted by slug, same order as csv.ts', () => {
  const payload = JSON.parse(plan()) as { games: { slug: string }[] }
  const slugs = payload.games.map((game) => game.slug)
  assert.deepEqual(slugs, [...slugs].sort())
})

test('a game row has exactly the csv column names', () => {
  const payload = JSON.parse(plan()) as { games: Record<string, unknown>[] }
  const game = payload.games[0]!
  assert.deepEqual(
    Object.keys(game).sort(),
    ['developer', 'game_id', 'publisher', 'release_year', 'slug', 'status', 'title'].sort(),
  )
})

test('two builds from the same state are byte-identical', () => {
  const first = plan()
  const second = plan()
  assert.equal(first, second)
})
