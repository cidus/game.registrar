/**
 * Deriving a game's attachments from the fold (docs/spec/01-model.md
 * "Attachments"). `state.attachments` is keyed by target — an event id, or a
 * game id — with no notion of which game an event belongs to; this is the
 * ownership resolution that makes a gallery possible.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { EventEnvelope } from '../src/core/events.ts'
import { attachmentsOfGame, fold, gameOfEvent } from '../src/core/fold.ts'
import { translator } from '../src/i18n/index.ts'
import { galleryBlock, headerBlock } from '../src/render/note.ts'
import { context, event } from './helpers.ts'

const bundle = translator('en')

function baseLog(): EventEnvelope[] {
  return [
    event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' }),
    event('game.create', { game_id: 'G2', slug: 'celeste', title: 'Celeste' }),
    event('run.open', {
      run_id: 'R1',
      game_id: 'G1',
      platform: 'Switch',
      form: 'digital',
      mode: 'solo',
      started_on: '2026-05-03',
      replay: false,
    }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2026-05-03T20:00:00-03:00' }),
  ]
}

test('an inline attachment on a session event is found by the game it belongs to', () => {
  const events = baseLog()
  events.push(
    event('session.close', {
      session_id: 'S1',
      at: '2026-05-03T22:00:00-03:00',
      attachments: [{ sha256: 'a'.repeat(64), ext: 'webp', caption: 'Watcher Knights', captured_at: null, kind: 'screenshot' }],
    }),
  )
  const state = fold(events, context)
  const game1 = state.gamesById.get('G1')!
  const game2 = state.gamesById.get('G2')!

  const gallery = attachmentsOfGame(state, game1)
  assert.equal(gallery.length, 1)
  assert.equal(gallery[0]?.attachment.caption, 'Watcher Knights')
  assert.equal(gallery[0]?.at, '2026-05-03T22:00:00-03:00')

  assert.equal(attachmentsOfGame(state, game2).length, 0)
})

test('a retroactive attachment.add against an event lands on the owning game only', () => {
  const events = baseLog()
  const closeEvent = event('session.close', { session_id: 'S1', at: '2026-05-03T22:00:00-03:00' })
  events.push(closeEvent)
  events.push(
    event('attachment.add', {
      target: closeEvent.id,
      attachments: [{ sha256: 'b'.repeat(64), ext: 'webp', caption: null, captured_at: null, kind: 'other' }],
    }),
  )
  const state = fold(events, context)
  assert.equal(attachmentsOfGame(state, state.gamesById.get('G1')!).length, 1)
  assert.equal(attachmentsOfGame(state, state.gamesById.get('G2')!).length, 0)
})

test('an attachment filed directly against the game id is on its gallery, even with no runs', () => {
  const events = baseLog()
  events.push(
    event('attachment.add', {
      target: 'G2',
      attachments: [{ sha256: 'c'.repeat(64), ext: 'webp', caption: 'Box art', captured_at: null, kind: 'box' }],
    }),
  )
  const state = fold(events, context)
  const gallery = attachmentsOfGame(state, state.gamesById.get('G2')!)
  assert.equal(gallery.length, 1)
  assert.equal(gallery[0]?.attachment.caption, 'Box art')
})

test('the same hash attached at both the game level and an event level counts once', () => {
  const events = baseLog()
  const sha = 'd'.repeat(64)
  const closeEvent = event('session.close', {
    session_id: 'S1',
    at: '2026-05-03T22:00:00-03:00',
    attachments: [{ sha256: sha, ext: 'webp', caption: null, captured_at: null, kind: 'other' }],
  })
  events.push(closeEvent)
  events.push(event('attachment.add', { target: 'G1', attachments: [{ sha256: sha, ext: 'webp', caption: null, captured_at: null, kind: 'other' }] }))

  const state = fold(events, context)
  assert.equal(attachmentsOfGame(state, state.gamesById.get('G1')!).length, 1)
})

test('gallery entries sort chronologically, oldest first', () => {
  const events = baseLog()
  events.push(
    event('session.close', {
      session_id: 'S1',
      at: '2026-05-03T22:00:00-03:00',
      attachments: [{ sha256: 'e'.repeat(64), ext: 'webp', caption: 'second', captured_at: null, kind: 'other' }],
    }),
  )
  events.push(
    event('attachment.add', {
      target: 'G1',
      attachments: [{ sha256: 'f'.repeat(64), ext: 'webp', caption: 'first, captured earlier', captured_at: '2026-01-01T00:00:00', kind: 'other' }],
    }),
  )
  const state = fold(events, context)
  const gallery = attachmentsOfGame(state, state.gamesById.get('G1')!)
  // The game-level attachment sorts first: it has no event `at`, so it keys
  // on the empty string, which is earlier than any real timestamp.
  assert.deepEqual(
    gallery.map((entry) => entry.attachment.caption),
    ['first, captured earlier', 'second'],
  )
})

test('the gallery block embeds each photo by its content-addressed path, oldest first', () => {
  const events = baseLog()
  const sha = 'a'.repeat(64)
  events.push(
    event('session.close', {
      session_id: 'S1',
      at: '2026-05-03T22:00:00-03:00',
      attachments: [{ sha256: sha, ext: 'webp', caption: 'Watcher Knights, finally', captured_at: null, kind: 'screenshot' }],
    }),
  )
  const state = fold(events, context)
  const block = galleryBlock(state, state.gamesById.get('G1')!, bundle)
  assert.equal(block, `![[assets/${sha.slice(0, 2)}/${sha}.webp]]\n*2026-05-03 — Watcher Knights, finally*`)
})

test('a game with no attachments has no gallery block', () => {
  const state = fold(baseLog(), context)
  assert.equal(galleryBlock(state, state.gamesById.get('G1')!, bundle), '')
})

test('a photo with no caption renders the date alone', () => {
  const events = baseLog()
  const sha = 'b'.repeat(64)
  events.push(event('attachment.add', { target: 'G1', attachments: [{ sha256: sha, ext: 'webp', caption: null, captured_at: '2020-01-01T00:00:00', kind: 'other' }] }))
  const state = fold(events, context)
  const block = galleryBlock(state, state.gamesById.get('G1')!, bundle)
  assert.equal(block, `![[assets/${sha.slice(0, 2)}/${sha}.webp]]\n*2020-01-01*`)
})

test('a user cover is embedded at the top of the header block; a provider cover (URL only) is not', () => {
  const events = baseLog()
  const sha = 'c'.repeat(64)
  const withUserCover = fold([...events, event('game.cover', { game_id: 'G1', sha256: sha, source: 'user' })], context)
  const header = headerBlock(withUserCover.gamesById.get('G1')!, bundle)
  assert.match(header, new RegExp(`^!\\[\\[assets/${sha.slice(0, 2)}/${sha}\\.webp\\]\\]\\n`))

  const withProviderCover = fold(
    [...events, event('game.cover', { game_id: 'G1', url: 'https://example.com/cover.jpg', source: 'provider' })],
    context,
  )
  const providerHeader = headerBlock(withProviderCover.gamesById.get('G1')!, bundle)
  assert.equal(providerHeader.includes('![['), false)
})

test('gameOfEvent resolves through run_id and session_id, not only a direct game_id', () => {
  const events = baseLog()
  const sessionClose = event('session.close', { session_id: 'S1', at: '2026-05-03T22:00:00-03:00' })
  events.push(sessionClose)
  const state = fold(events, context)

  assert.equal(gameOfEvent(state, sessionClose)?.game_id, 'G1')
  assert.equal(gameOfEvent(state, events[2]!)?.game_id, 'G1') // run.open, via game_id directly
  assert.equal(gameOfEvent(state, event('game.alias', { game_id: 'G2', alias: 'x' }))?.game_id, 'G2')
})
