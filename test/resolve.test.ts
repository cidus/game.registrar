import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fold, type GameState, type VaultState } from '../src/core/fold.ts'
import { candidateFromProvider, candidateOf, CANDIDATE_LIMIT, resolveLocal, search } from '../src/resolve/resolve.ts'
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

/**
 * A game nobody has recorded a platform for is not a game that exists nowhere.
 * Reading `[]` as "matches nothing" made a `--no-metadata` entry unreachable by
 * its own exact title the moment a platform was named — and `start`/`past`
 * resolve with `allowCreate`, so the next step was a duplicate record.
 */
test('a game with no platforms on record is never filtered out by the hint', () => {
  // G3 (Celeste) was created with no platforms and never enriched.
  const byTitle = resolveLocal(vault(), 'celeste', { platform: 'Switch' })
  assert.equal(byTitle.kind === 'resolved' && byTitle.game.game_id, 'G3')

  // Any platform at all, since the field says nothing either way.
  const other = resolveLocal(vault(), 'celeste', { platform: 'Dreamcast' })
  assert.equal(other.kind === 'resolved' && other.game.game_id, 'G3')

  // And through the alias, which is the same pool.
  assert.equal(search(vault(), 'cel', 'PS5').length, 1)
})

test('a game that does have platforms is still filtered by them', () => {
  // The forgiving rule above is about silence, not about overriding evidence.
  const state = vault()
  assert.equal(resolveLocal(state, 'tears of the kingdom', { platform: 'Wii U' }).kind, 'not_found')
  assert.equal(search(state, 'zelda', 'Wii U').length, 1)
})

test('the platform hint filters the list without answering it', () => {
  const resolution = resolveLocal(vault(), 'zelda', { platform: 'wii u' })
  assert.equal(resolution.kind === 'resolved' && resolution.game.game_id, 'G1')

  const still = resolveLocal(vault(), 'zelda', { platform: 'Switch' })
  assert.equal(still.kind, 'ambiguous')
})

test('the hint is canonicalized before it filters, so a synonym narrows identically', () => {
  // The record says "Wii U"; the user typed the spelling they had in mind.
  const resolution = resolveLocal(vault(), 'zelda', { platform: 'WiiU' })
  assert.equal(resolution.kind === 'resolved' && resolution.game.game_id, 'G1')

  // Still a filter, never an answer: a spelling that matches nothing narrows
  // to nothing rather than resolving anything.
  assert.equal(resolveLocal(vault(), 'zelda', { platform: 'Dreamcast' }).kind, 'not_found')
})

test('nothing on record is not_found — resolveLocal never asks a provider, even in phase 1', () => {
  assert.equal(resolveLocal(vault(), 'hades').kind, 'not_found')
  assert.equal(resolveLocal(vault(), '   ').kind, 'not_found')
})

test('a provider candidate is shaped like a local one, ref-prefixed by provider name', () => {
  const candidate = candidateFromProvider('igdb', {
    id: '7346',
    title: 'Hollow Knight',
    year: 2017,
    platforms: ['PC'],
    cover_url: 'https://example.com/cover.jpg',
  })
  assert.deepEqual(candidate, {
    ref: 'igdb:7346',
    title: 'Hollow Knight',
    year: 2017,
    platforms: ['PC'],
    source: 'provider',
    in_log: false,
    cover_url: 'https://example.com/cover.jpg',
  })
})

test('candidateOf carries a provider-sourced cover, and null for a user photo or no cover at all', () => {
  const state = fold(
    [
      event('game.create', { game_id: 'G1', slug: 'sifu', title: 'Sifu' }),
      event('game.cover', { game_id: 'G1', url: 'https://example.com/sifu.jpg', source: 'provider' }),
      event('game.create', { game_id: 'G2', slug: 'sifu-photo', title: 'Sifu Photo' }),
      event('game.cover', { game_id: 'G2', sha256: 'a'.repeat(64), source: 'user' }),
      event('game.create', { game_id: 'G3', slug: 'sifu-none', title: 'Sifu None' }),
    ],
    context,
  )
  const gameNamed = (id: string): GameState => state.games.find((game) => game.game_id === id)!
  assert.equal(candidateOf(gameNamed('G1')).cover_url, 'https://example.com/sifu.jpg')
  assert.equal(candidateOf(gameNamed('G2')).cover_url, null)
  assert.equal(candidateOf(gameNamed('G3')).cover_url, null)
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
