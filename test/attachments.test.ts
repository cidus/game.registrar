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
import { tableBlock } from '../src/render/table.ts'
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

/**
 * A photo filed straight against the game has no session or run to date it.
 * It used to be dated with the empty string, which sorted it before everything
 * and rendered a bare `**` into the note where the date belongs — found by
 * putting a real photo in example-vault, which is what that fixture is for.
 */
test('a photo filed against the game is dated by the event that filed it', () => {
  const events = baseLog()
  const sha = 'c'.repeat(64)
  events.push(
    event(
      'attachment.add',
      { target: 'G1', attachments: [{ sha256: sha, ext: 'webp', caption: null, captured_at: null, kind: 'photo' }] },
      '2026-08-16T10:07:00-03:00',
    ),
  )
  const state = fold(events, context)

  const [entry] = attachmentsOfGame(state, state.gamesById.get('G1')!)
  assert.equal(entry?.at, '2026-08-16T10:07:00-03:00')

  const block = galleryBlock(state, state.gamesById.get('G1')!, bundle)
  assert.equal(block, `![[assets/${sha.slice(0, 2)}/${sha}.webp]]\n*2026-08-16*`)
})

test('an undated, uncaptioned photo renders as the photo, not as empty emphasis', () => {
  // `captured_at` absent and the filing event unknown: there is nothing true to
  // say under the image, so nothing is said.
  const state = fold(baseLog(), context)
  const sha = 'd'.repeat(64)
  state.attachments.set('G1', [{ sha256: sha, ext: 'webp', caption: null, captured_at: null, kind: 'other' }])

  const block = galleryBlock(state, state.gamesById.get('G1')!, bundle)
  assert.equal(block, `![[assets/${sha.slice(0, 2)}/${sha}.webp]]`)
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

test('a downloaded provider cover (has a sha256) embeds the same as a user one', () => {
  const events = baseLog()
  const sha = 'd'.repeat(64)
  const state = fold(
    [...events, event('game.enrich', { game_id: 'G1', provider: 'igdb', fields: {}, cover: { url: 'https://example.com/x.jpg', sha256: sha } })],
    context,
  )
  const header = headerBlock(state.gamesById.get('G1')!, bundle)
  assert.match(header, new RegExp(`^!\\[\\[assets/${sha.slice(0, 2)}/${sha}\\.webp\\]\\]\\n`))
})

test('the consolidated table embeds a reduced cover, only once one is locally ingested', () => {
  const events = baseLog()
  const withoutCover = tableBlock(fold(events, context), bundle)
  const g1Row = withoutCover.split('\n').find((line) => line.includes('hollow-knight'))!
  assert.match(g1Row, /^\|\s*\|/) // the cover column is the first, and empty

  const sha = 'e'.repeat(64)
  const withCover = tableBlock(
    fold([...events, event('game.cover', { game_id: 'G1', sha256: sha, source: 'user' })], context),
    bundle,
  )
  const coveredRow = withCover.split('\n').find((line) => line.includes('hollow-knight'))!
  assert.match(coveredRow, new RegExp(`^\\|\\s*!\\[\\[assets/${sha.slice(0, 2)}/${sha}\\.webp\\\\\\|32\\]\\]\\s*\\|`))
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
