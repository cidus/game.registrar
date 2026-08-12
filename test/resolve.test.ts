import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fold, type VaultState } from '../src/core/fold.ts'
import { CANDIDATE_LIMIT, resolveLocal, search } from '../src/resolve/resolve.ts'
import { context, event } from './helpers.ts'

function vault(): VaultState {
  return fold(
    [
      event('game.create', {
        game_id: 'G1',
        slug: 'zelda-botw',
        title: 'The Legend of Zelda: Breath of the Wild',
        release_year: 2017,
        platforms: ['Switch', 'Wii U'],
        providers: { igdb: 7346 },
      }),
      event('game.create', {
        game_id: 'G2',
        slug: 'zelda-totk',
        title: 'The Legend of Zelda: Tears of the Kingdom',
        release_year: 2023,
        platforms: ['Switch'],
      }),
      event('game.create', { game_id: 'G3', slug: 'celeste', title: 'Celeste', release_year: 2018 }),
      event('game.alias', { game_id: 'G3', alias: 'cel' }),
      event('run.open', { run_id: 'R1', game_id: 'G2', platform: 'Switch', started_on: '2026-01-01' }),
    ],
    context,
  )
}

test('an explicit reference skips the search entirely', () => {
  const state = vault()
  const byGame = resolveLocal(state, 'nonsense', { id: 'game:G1' })
  assert.equal(byGame.kind === 'resolved' && byGame.game.game_id, 'G1')

  const byProvider = resolveLocal(state, null, { id: 'igdb:7346' })
  assert.equal(byProvider.kind === 'resolved' && byProvider.game.game_id, 'G1')

  assert.equal(resolveLocal(state, null, { id: 'game:ghost' }).kind, 'not_found')
})

test('an exact alias resolves', () => {
  const resolution = resolveLocal(vault(), 'cel')
  assert.equal(resolution.kind === 'resolved' && resolution.game.game_id, 'G3')
})

test('a unique substring resolves', () => {
  const resolution = resolveLocal(vault(), 'tears of the kingdom')
  assert.equal(resolution.kind === 'resolved' && resolution.game.game_id, 'G2')
})

test('two local hits are ambiguous, and the network is not consulted', () => {
  const resolution = resolveLocal(vault(), 'zelda')
  assert.equal(resolution.kind, 'ambiguous')
  if (resolution.kind !== 'ambiguous') return
  assert.equal(resolution.candidates.length, 2)
  assert.equal(resolution.candidates.every((candidate) => candidate.source === 'local'), true)
  // A game being played outranks everything else.
  assert.equal(resolution.candidates[0]?.title, 'The Legend of Zelda: Tears of the Kingdom')
  assert.equal(resolution.candidates[0]?.ref, 'game:G2')
})

test('an exact title wins over titles that merely contain it', () => {
  const state = fold(
    [
      event('game.create', { game_id: 'G1', slug: 'zelda', title: 'Zelda' }),
      event('game.create', { game_id: 'G2', slug: 'zelda-2', title: 'Zelda II' }),
    ],
    context,
  )
  const resolution = resolveLocal(state, 'zelda')
  assert.equal(resolution.kind === 'resolved' && resolution.game.game_id, 'G1')
})

test('the platform hint filters the list without answering it', () => {
  const resolution = resolveLocal(vault(), 'zelda', { platform: 'wii u' })
  assert.equal(resolution.kind === 'resolved' && resolution.game.game_id, 'G1')

  const still = resolveLocal(vault(), 'zelda', { platform: 'Switch' })
  assert.equal(still.kind, 'ambiguous')
})

test('nothing on record is not_found — phase 0 never asks a provider', () => {
  assert.equal(resolveLocal(vault(), 'hades').kind, 'not_found')
  assert.equal(resolveLocal(vault(), '   ').kind, 'not_found')
})

test('candidates are capped at eight and flagged as truncated', () => {
  const events = Array.from({ length: 12 }, (_, index) =>
    event('game.create', { game_id: `G${index}`, slug: `mario-${index}`, title: `Mario Party ${index}` }),
  )
  const resolution = resolveLocal(fold(events, context), 'mario party')
  assert.equal(resolution.kind, 'ambiguous')
  if (resolution.kind !== 'ambiguous') return
  assert.equal(resolution.candidates.length, CANDIDATE_LIMIT)
  assert.equal(resolution.truncated, true)
})

test('search never writes and returns the same ranking', () => {
  const found = search(vault(), 'zelda')
  assert.deepEqual(
    found.map((game) => game.game_id),
    ['G2', 'G1'],
  )
})
