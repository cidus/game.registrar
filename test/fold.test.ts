import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { EventEnvelope } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { context, event } from './helpers.ts'

function log(): EventEnvelope[] {
  return [
    event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight', platforms: ['Switch'] }),
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
    event('session.close', { session_id: 'S1', at: '2026-05-03T23:00:00-03:00', note: 'Tight combat.' }),
  ]
}

test('a closed session contributes its gross duration', () => {
  const state = fold(log(), context)
  const session = state.sessionsById.get('S1')
  assert.equal(session?.minutes, 180)
  assert.equal(session?.open, false)
  assert.equal(state.runsById.get('R1')?.minutes, 180)
  assert.equal(state.gamesById.get('G1')?.total_minutes, 180)
  assert.equal(state.gamesById.get('G1')?.status, 'playing')
  assert.equal(state.problems.length, 0)
})

test('logged breaks and declared break minutes are both deducted', () => {
  const events = log()
  events.splice(3, 0, event('break.open', { break_id: 'B1', session_id: 'S1', at: '2026-05-03T21:00:00-03:00' }))
  events.splice(4, 0, event('break.close', { break_id: 'B1', at: '2026-05-03T21:30:00-03:00' }))
  events[5] = event('session.close', { session_id: 'S1', at: '2026-05-03T23:00:00-03:00', break_minutes: 20 })

  const session = fold(events, context).sessionsById.get('S1')
  assert.equal(session?.minutes, 130)
  assert.equal(session?.break_minutes, 50)
})

test('a break left open is closed at the moment the session closes', () => {
  const events = log()
  events.splice(3, 0, event('break.open', { break_id: 'B1', session_id: 'S1', at: '2026-05-03T22:00:00-03:00' }))

  const state = fold(events, context)
  assert.equal(state.breaksById.get('B1')?.open, false)
  assert.equal(state.breaksById.get('B1')?.minutes, 60)
  assert.equal(state.sessionsById.get('S1')?.minutes, 120)
})

test('an open session contributes zero minutes and is never estimated', () => {
  const events = log().slice(0, 3)
  const state = fold(events, context)
  assert.equal(state.sessionsById.get('S1')?.minutes, 0)
  assert.equal(state.sessionsById.get('S1')?.open, true)
  assert.equal(state.gamesById.get('G1')?.total_minutes, 0)
})

test('a session closing before it opens is a problem and counts as zero', () => {
  const events = log()
  events[3] = event('session.close', { session_id: 'S1', at: '2026-05-03T19:00:00-03:00' })

  const state = fold(events, context)
  assert.equal(state.sessionsById.get('S1')?.minutes, 0)
  assert.equal(state.problems[0]?.key, 'doctor.closed_before_open')
})

test('breaks longer than the session are a problem, not a negative total', () => {
  const events = log()
  events[3] = event('session.close', { session_id: 'S1', at: '2026-05-03T23:00:00-03:00', break_minutes: 400 })

  const state = fold(events, context)
  assert.equal(state.sessionsById.get('S1')?.minutes, 0)
  assert.equal(state.problems[0]?.key, 'doctor.negative_duration')
})

test('the logical day of a session that runs past midnight is the day it started', () => {
  const events = log()
  events[2] = event('session.open', { session_id: 'S1', run_id: 'R1', at: '2026-05-03T22:00:00-03:00' })
  events[3] = event('session.close', { session_id: 'S1', at: '2026-05-04T02:30:00-03:00' })

  const state = fold(events, context)
  assert.equal(state.sessionsById.get('S1')?.logical_day, '2026-05-03')
  assert.equal(state.sessionsById.get('S1')?.minutes, 270)
})

test('closing a run derives status and keeps the rating as written', () => {
  const events = log()
  events.push(
    event('run.close', {
      run_id: 'R1',
      ended_on: '2026-08-12',
      outcome: 'finished',
      completion_criteria: 'true_ending',
      rating: 11,
      difficulty: 'hard',
    }),
  )

  const state = fold(events, context)
  assert.equal(state.gamesById.get('G1')?.status, 'finished')
  assert.equal(state.runsById.get('R1')?.rating, 11)
  assert.equal(state.runsById.get('R1')?.open, false)
})

test('an imported run states its hours instead of measuring them', () => {
  const events = [
    event('game.create', { game_id: 'G2', slug: 'chrono-trigger', title: 'Chrono Trigger' }),
    event('run.import', {
      run_id: 'R9',
      game_id: 'G2',
      platform: 'SNES',
      started_on: '2011-01-01',
      ended_on: '2011-07-01',
      date_precision: 'month',
      outcome: 'finished',
      completion_criteria: 'credits',
      rating: 10,
      hours: 30,
    }),
  ]

  const run = fold(events, context).runsById.get('R9')
  assert.equal(run?.minutes, 1800)
  assert.equal(run?.hours_source, 'stated')
  assert.equal(run?.open, false)
})

test('a run.open with a stated baseline stays open, and mixes with sessions logged on it later', () => {
  const events = [
    event('game.create', { game_id: 'G3', slug: 'opus-magnum', title: 'Opus Magnum' }),
    event('run.open', {
      run_id: 'R10',
      game_id: 'G3',
      platform: 'Steam',
      started_on: '2026-01-01',
      date_precision: 'year',
      replay: false,
      hours: 30,
    }),
  ]

  const openOnly = fold(events, context).runsById.get('R10')
  assert.equal(openOnly?.stated_minutes, 1800)
  assert.equal(openOnly?.minutes, 1800)
  assert.equal(openOnly?.hours_source, 'stated')
  assert.equal(openOnly?.open, true)
  assert.equal(openOnly?.sessions.length, 0)

  const withSession = [
    ...events,
    event('session.open', { session_id: 'S9', run_id: 'R10', at: '2026-08-14T20:00:00-03:00' }),
    event('session.close', { session_id: 'S9', at: '2026-08-14T21:30:00-03:00' }),
  ]

  const mixed = fold(withSession, context).runsById.get('R10')
  assert.equal(mixed?.stated_minutes, 1800)
  assert.equal(mixed?.minutes, 1890)
  assert.equal(mixed?.hours_source, 'mixed')
})

test('an ordinary run.open, with no stated hours, is measured as before', () => {
  const state = fold(log(), context)
  const run = state.runsById.get('R1')
  assert.equal(run?.stated_minutes, 0)
  assert.equal(run?.hours_source, 'measured')
  assert.equal(run?.minutes, 180)
})

test('replaying the log twice yields identical state', () => {
  const events = log()
  assert.deepEqual(fold(events, context).games, fold(events, context).games)
})

test('an amend applied to an event gives the state the original would have', () => {
  const events = log()
  const target = events[3]!.id
  const amended = [...events, event('event.amend', { target, reason: 'wrong hour', patch: { at: '2026-05-03T22:00:00-03:00' } })]

  const written = log()
  written[3] = event('session.close', { session_id: 'S1', at: '2026-05-03T22:00:00-03:00', note: 'Tight combat.' })

  assert.equal(fold(amended, context).sessionsById.get('S1')?.minutes, 120)
  assert.deepEqual(
    fold(amended, context).sessionsById.get('S1')?.minutes,
    fold(written, context).sessionsById.get('S1')?.minutes,
  )
})

test('a revoked event is ignored by the fold and stays in the file', () => {
  const events = log()
  const target = events[3]!.id
  const revoked = [...events, event('event.revoke', { target, reason: 'never happened' })]

  const state = fold(revoked, context)
  assert.equal(state.sessionsById.get('S1')?.open, true)
  assert.equal(state.sessionsById.get('S1')?.minutes, 0)
  assert.equal(state.eventsById.has(target), true)
})

test('revoking an amend puts the original payload back', () => {
  const events = log()
  const target = events[3]!.id
  const amend = event('event.amend', { target, reason: 'wrong hour', patch: { at: '2026-05-03T22:00:00-03:00' } })
  const state = fold([...events, amend, event('event.revoke', { target: amend.id, reason: 'my mistake' })], context)

  assert.equal(state.sessionsById.get('S1')?.minutes, 180)
})

test('orphan references are reported instead of crashing the fold', () => {
  const state = fold([event('session.close', { session_id: 'ghost', at: '2026-05-03T23:00:00-03:00' })], context)
  assert.equal(state.problems[0]?.key, 'doctor.orphan_reference')
})

test('status is unplayed with no runs and playing while one is open', () => {
  const created = [event('game.create', { game_id: 'G3', slug: 'x', title: 'X' })]
  assert.equal(fold(created, context).gamesById.get('G3')?.status, 'unplayed')

  const started = [...created, event('run.open', { run_id: 'R3', game_id: 'G3', started_on: '2026-01-01' })]
  assert.equal(fold(started, context).gamesById.get('G3')?.status, 'playing')
})

test('an alias is recorded once, however many times it is taught', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' }),
    event('game.alias', { game_id: 'G1', alias: 'hollow' }),
    event('game.alias', { game_id: 'G1', alias: 'hollow' }),
  ]
  assert.deepEqual(fold(events, context).gamesById.get('G1')?.aliases, ['hollow'])
})

test('a rename remembers the slug it left behind', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'hollow', title: 'Hollow' }),
    event('game.rename', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' }),
  ]
  const game = fold(events, context).gamesById.get('G1')
  assert.equal(game?.slug, 'hollow-knight')
  assert.deepEqual(game?.previous_slugs, ['hollow'])
})

test('enrichment never replaces a cover the user chose', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'x', title: 'X' }),
    event('game.cover', { game_id: 'G1', sha256: 'abc', source: 'user' }),
    event('game.enrich', { game_id: 'G1', provider: 'igdb', fields: { id: 7346 }, cover: 'https://example/art.jpg' }),
  ]
  const game = fold(events, context).gamesById.get('G1')
  assert.equal(game?.cover?.source, 'user')
  assert.equal(game?.cover?.sha256, 'abc')
  assert.equal(game?.providers['igdb'], 7346)
})

test('a downloaded provider cover carries both the url and the sha256', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'x', title: 'X' }),
    event('game.enrich', {
      game_id: 'G1',
      provider: 'igdb',
      fields: { id: 7346 },
      cover: { url: 'https://example/art.jpg', sha256: 'a'.repeat(64) },
    }),
  ]
  const game = fold(events, context).gamesById.get('G1')
  assert.equal(game?.cover?.source, 'provider')
  assert.equal(game?.cover?.url, 'https://example/art.jpg')
  assert.equal(game?.cover?.sha256, 'a'.repeat(64))
})

test('a downloaded provider cover is still never allowed to replace a user cover', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'x', title: 'X' }),
    event('game.cover', { game_id: 'G1', sha256: 'abc', source: 'user' }),
    event('game.enrich', {
      game_id: 'G1',
      provider: 'igdb',
      fields: { id: 7346 },
      cover: { url: 'https://example/art.jpg', sha256: 'a'.repeat(64) },
    }),
  ]
  const game = fold(events, context).gamesById.get('G1')
  assert.equal(game?.cover?.source, 'user')
  assert.equal(game?.cover?.sha256, 'abc')
})

test('enrichment corrects the title and files the previous one as an alias', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'chrono-trigger', title: 'Chrono Triger' }),
    event('game.enrich', { game_id: 'G1', provider: 'igdb', fields: { id: 2364, title: 'Chrono Trigger' } }),
  ]
  const game = fold(events, context).gamesById.get('G1')
  assert.equal(game?.title, 'Chrono Trigger')
  assert.deepEqual(game?.aliases, ['chrono triger'])
})

test('a second enrich with the same title adds no duplicate alias', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'chrono-trigger', title: 'Chrono Triger' }),
    event('game.enrich', { game_id: 'G1', provider: 'igdb', fields: { id: 2364, title: 'Chrono Trigger' } }),
    event('game.enrich', { game_id: 'G1', provider: 'rawg', fields: { id: 99, title: 'Chrono Trigger' } }),
  ]
  const game = fold(events, context).gamesById.get('G1')
  assert.equal(game?.title, 'Chrono Trigger')
  assert.deepEqual(game?.aliases, ['chrono triger'])
})

test('enrichment leaves the title untouched when the provider does not carry one', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'x', title: 'X' }),
    event('game.enrich', { game_id: 'G1', provider: 'igdb', fields: { id: 7346 } }),
  ]
  const game = fold(events, context).gamesById.get('G1')
  assert.equal(game?.title, 'X')
  assert.deepEqual(game?.aliases, [])
})
