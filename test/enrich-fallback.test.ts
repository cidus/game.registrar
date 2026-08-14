/**
 * `enrichGame`'s provider fallback (src/cli/commands/enrich.ts) — unit-level,
 * with fake providers, so it never touches real credentials or the network.
 *
 * Regression coverage for a real bug: with only IGDB configured, enriching a
 * game IGDB had no confident match for was reported as "rawg is not
 * configured" — a working provider's honest "nothing found" was getting
 * overwritten by the *next* provider in the chain simply being unconfigured.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'

import type { Cli } from '../src/cli/context.ts'
import { ambiguousOutcomeError, applyDetail, enrichGame } from '../src/cli/commands/enrich.ts'
import type { Workspace } from '../src/cli/workspace.ts'
import { GameregError } from '../src/core/errors.ts'
import { fold } from '../src/core/fold.ts'
import { nowIn } from '../src/core/time.ts'
import { openVault } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { CANDIDATE_LIMIT } from '../src/resolve/resolve.ts'
import type { Provider, ProviderCandidate, ProviderDetail } from '../src/providers/provider.ts'
import { context as timeContext, event, tempDir } from './helpers.ts'

function fakeCli(): Cli {
  const vault = openVault(tempDir())
  const bundle = translator('en')
  const now = nowIn(timeContext)
  return {
    vault,
    time: timeContext,
    now,
    at: now,
    atGiven: false,
    json: true,
    interactive: false,
    quiet: false,
    dryRun: true,
    yes: false,
    source: 'cli',
    t: bundle.t,
    label: bundle.label,
    locale: 'en',
  }
}

function fakeWorkspace(): Workspace {
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  return { events, state: fold(events, timeContext), pending: [] }
}

/** A provider that is simply not configured — the common case for whichever one the user didn't set up. */
function unavailable(name: string): Provider {
  const fail = async (): Promise<never> => {
    throw new GameregError('provider_unavailable', 'error.provider_credential_missing', {
      provider: name,
      missing: `${name.toUpperCase()}_API_KEY`,
    })
  }
  return { name, search: fail, fetch: fail, findExact: fail }
}

/** A provider that is reachable and answers, but has nothing for this title. */
function noMatch(name: string): Provider {
  return { name, search: async () => [], fetch: async () => null, findExact: async () => [] }
}

/** A provider that finds an exact match. */
function matching(name: string, detail: ProviderDetail): Provider {
  const results = async (query: string): Promise<ProviderCandidate[]> => [
    { id: detail.id, title: query, year: null, platforms: [], cover_url: null },
  ]
  return { name, search: results, findExact: results, fetch: async () => detail }
}

const DETAIL: ProviderDetail = {
  id: '7346',
  fields: { title: 'Hollow Knight', release_year: 2017, developer: 'Team Cherry', publisher: null, genres: [], platforms: [] },
  cover_url: null,
}

test('a configured provider finding nothing is skipped, never reported as the next one being unconfigured', async () => {
  const cli = fakeCli()
  const workspace = fakeWorkspace()
  const game = workspace.state.games[0]!

  const outcome = await enrichGame(cli, workspace, game, [noMatch('igdb'), unavailable('rawg')], false, false)
  assert.deepEqual(outcome, { kind: 'skipped' })
})

test('the order does not matter: an unavailable provider before a reachable no-match is still skipped', async () => {
  const cli = fakeCli()
  const workspace = fakeWorkspace()
  const game = workspace.state.games[0]!

  const outcome = await enrichGame(cli, workspace, game, [unavailable('rawg'), noMatch('igdb')], false, false)
  assert.deepEqual(outcome, { kind: 'skipped' })
})

test('every provider unavailable is reported failed, naming every one of them', async () => {
  const cli = fakeCli()
  const workspace = fakeWorkspace()
  const game = workspace.state.games[0]!

  const outcome = await enrichGame(cli, workspace, game, [unavailable('igdb'), unavailable('rawg')], false, false)
  assert.equal(outcome.kind, 'failed')
  if (outcome.kind === 'failed') {
    assert.match(outcome.message, /igdb/i)
    assert.match(outcome.message, /rawg/i)
  }
})

test('a match on the second provider still enriches, even though the first was unavailable', async () => {
  const cli = fakeCli()
  const workspace = fakeWorkspace()
  const game = workspace.state.games[0]!

  const outcome = await enrichGame(cli, workspace, game, [unavailable('igdb'), matching('rawg', DETAIL)], false, false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'rawg' })
})

test('a match on the first provider never even asks the second', async () => {
  const cli = fakeCli()
  const workspace = fakeWorkspace()
  const game = workspace.state.games[0]!
  let asked = false
  const spy: Provider = {
    name: 'rawg',
    search: async () => [],
    findExact: async () => {
      asked = true
      return []
    },
    fetch: async () => null,
  }

  const outcome = await enrichGame(cli, workspace, game, [matching('igdb', DETAIL), spy], false, false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })
  assert.equal(asked, false)
})

test('a provider title with a trailing (year) still auto-matches the local title', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'ff7r', title: 'Final Fantasy VII Remake' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const ff7rCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: '1234', title: 'Final Fantasy VII Remake (2020)', year: 2020, platforms: [], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: ff7rCandidates,
    findExact: ff7rCandidates,
    fetch: async () => ({
      id: '1234',
      fields: {
        title: 'Final Fantasy VII Remake',
        release_year: 2020,
        developer: null,
        publisher: null,
        genres: [],
        platforms: [],
      },
      cover_url: null,
    }),
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })
})

test('a "Deluxe Edition" catalog entry does not collide with the base game', async () => {
  // Regression: IGDB really does carry "Final Fantasy VII Remake: Deluxe
  // Edition" as its own entry, with its own id — verified against the live
  // API. Stripping edition suffixes from provider candidates collapsed both
  // onto the same normalized string, turning one confident match into a
  // false ambiguity that made enrich skip a well-known game.
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'ff7r', title: 'Final Fantasy VII Remake' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const deluxeCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: '11169', title: 'Final Fantasy VII Remake', year: 2020, platforms: [], cover_url: null },
    { id: '134226', title: 'Final Fantasy VII Remake: Deluxe Edition', year: 2020, platforms: [], cover_url: null },
    { id: '144024', title: 'Final Fantasy VII Remake Intergrade', year: 2021, platforms: [], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: deluxeCandidates,
    findExact: deluxeCandidates,
    fetch: async (id: string) => ({
      id,
      fields: { title: 'Final Fantasy VII Remake', release_year: 2020, developer: null, publisher: null, genres: [], platforms: [] },
      cover_url: null,
    }),
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })
})

test('two catalog entries with the exact same title report ambiguous — no guessing which platform SKU', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const hollowKnightCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: '1', title: 'Hollow Knight', year: 2017, platforms: ['Switch'], cover_url: null },
    { id: '2', title: 'Hollow Knight', year: 2017, platforms: ['PC'], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: hollowKnightCandidates,
    findExact: hollowKnightCandidates,
    fetch: async () => {
      throw new Error('must not be called: matching must stay ambiguous, never guessed')
    },
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false)
  assert.deepEqual(outcome, {
    kind: 'ambiguous',
    provider: 'igdb',
    candidates: [
      { id: '1', title: 'Hollow Knight', year: 2017, platforms: ['Switch'], cover_url: null },
      { id: '2', title: 'Hollow Knight', year: 2017, platforms: ['PC'], cover_url: null },
    ],
  })
})

test('a run recorded as an acronym narrows the catalog through the platform vocabulary', async () => {
  const cli = fakeCli()
  const events = [
    event('game.create', { game_id: 'G1', slug: 'chrono-trigger', title: 'Chrono Trigger' }),
    // What the user typed. The catalog spells it out in full, and no amount
    // of substring matching bridges the two.
    event('run.open', { run_id: 'R1', game_id: 'G1', platform: 'SNES', started_on: '2011-01-01' }),
  ]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const candidates = async (): Promise<ProviderCandidate[]> => [
    { id: '1802', title: 'Chrono Trigger', year: 1995, platforms: ['Super Nintendo Entertainment System'], cover_url: null },
    { id: '20398', title: 'Chrono Trigger', year: 2008, platforms: ['Nintendo DS'], cover_url: null },
    { id: '206320', title: 'Chrono Trigger', year: 2018, platforms: ['PC (Microsoft Windows)'], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: candidates,
    findExact: candidates,
    fetch: async (id: string) => {
      assert.equal(id, '1802', 'narrowed to the wrong release')
      return {
        id,
        fields: { title: 'Chrono Trigger', release_year: 1995, developer: null, publisher: null, genres: [], platforms: [] },
        cover_url: null,
      }
    },
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })
})

test('bulk (--all) never asks: an ambiguous provider still collapses to skipped', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const bulkCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: '1', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
    { id: '2', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: bulkCandidates,
    findExact: bulkCandidates,
    fetch: async () => {
      throw new Error('must not be called: bulk never resolves an ambiguity')
    },
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, true)
  assert.deepEqual(outcome, { kind: 'skipped' })
})

test('an ambiguous first provider still tries the second, which cleanly matches', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const stillAmbiguousCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: '1', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
    { id: '2', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: stillAmbiguousCandidates,
    findExact: stillAmbiguousCandidates,
    fetch: async () => {
      throw new Error('must not be called: igdb stays ambiguous, never fetched')
    },
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb, matching('rawg', DETAIL)], false, false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'rawg' })
})

test('ambiguous on every provider in the chain reports the first provider only', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const igdbCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: '1', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
    { id: '2', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: igdbCandidates,
    findExact: igdbCandidates,
    fetch: async () => {
      throw new Error('must not be called')
    },
  }
  const rawgCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: 'a', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
    { id: 'b', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
  ]
  const rawg: Provider = {
    name: 'rawg',
    search: rawgCandidates,
    findExact: rawgCandidates,
    fetch: async () => {
      throw new Error('must not be called')
    },
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb, rawg], false, false)
  assert.equal(outcome.kind, 'ambiguous')
  if (outcome.kind === 'ambiguous') {
    assert.equal(outcome.provider, 'igdb')
    assert.equal(outcome.candidates.length, 2)
  }
})

test('ambiguousOutcomeError shapes the ambiguous outcome as a code-3 error, same as any other resolution ambiguity', () => {
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const candidates: ProviderCandidate[] = [
    { id: '1', title: 'Hollow Knight', year: 2017, platforms: ['Switch'], cover_url: null },
    { id: '2', title: 'Hollow Knight', year: 2017, platforms: ['PC'], cover_url: null },
  ]

  const error = ambiguousOutcomeError(game, 'igdb', candidates)
  assert.equal(error.code, 3)
  assert.equal(error.error, 'ambiguous')
  const shaped = error.details['candidates'] as { ref: string; source: string; platforms: string[] }[]
  assert.deepEqual(
    shaped.map((candidate) => candidate.ref),
    ['igdb:1', 'igdb:2'],
  )
  assert.ok(shaped.every((candidate) => candidate.source === 'provider'))
  assert.equal(error.details['truncated'], undefined)
})

test('ambiguousOutcomeError caps candidates at CANDIDATE_LIMIT and flags truncated', () => {
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const candidates: ProviderCandidate[] = Array.from({ length: CANDIDATE_LIMIT + 3 }, (_, index) => ({
    id: String(index),
    title: 'Hollow Knight',
    year: 2017,
    platforms: [],
    cover_url: null,
  }))

  const error = ambiguousOutcomeError(game, 'igdb', candidates)
  const shaped = error.details['candidates'] as unknown[]
  assert.equal(shaped.length, CANDIDATE_LIMIT)
  assert.equal(error.details['truncated'], true)
})

test('an explicit searchTerm is sent to the provider instead of the game\'s stored title', async () => {
  // Regression for the enrich query bug (docs/spec/02-cli.md): a game stored
  // as "Pacman" (typed as-is on `start`) should be searchable by re-invoking
  // `gamereg enrich "Pac-Man"` — the literal retyped string, not the stored
  // title, must reach the provider's search.
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'pacman', title: 'Pacman' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const seenQueries: string[] = []
  const igdb: Provider = {
    name: 'igdb',
    search: async () => [],
    findExact: async (q: string) => {
      seenQueries.push(q)
      return [{ id: '1', title: 'Pac-Man', year: 1980, platforms: [], cover_url: null }]
    },
    fetch: async () => ({
      id: '1',
      fields: { title: 'Pac-Man', release_year: 1980, developer: null, publisher: null, genres: [], platforms: [] },
      cover_url: null,
    }),
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false, 'Pac-Man')
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })
  assert.deepEqual(seenQueries, ['Pac-Man'])
})

test('an omitted searchTerm falls back to the game\'s currently stored title', async () => {
  // Regression: the --all/cron path (and any caller that does not pass an
  // explicit searchTerm) must keep searching with the stored title, unchanged.
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'pacman', title: 'Pacman' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const seenQueries: string[] = []
  const igdb: Provider = {
    name: 'igdb',
    search: async () => [],
    findExact: async (q: string) => {
      seenQueries.push(q)
      return []
    },
    fetch: async () => null,
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false)
  assert.deepEqual(outcome, { kind: 'skipped' })
  assert.deepEqual(seenQueries, ['Pacman'])
})

test('applyDetail stages a game.enrich event and reports the enriched outcome', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const outcome = await applyDetail(cli, workspace, game, 'igdb', DETAIL, false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })

  const staged = workspace.pending.find((entry) => entry.type === 'game.enrich')
  assert.ok(staged)
  assert.equal(staged!.data['provider'], 'igdb')
  assert.deepEqual(staged!.data['fields'], { ...DETAIL.fields, id: DETAIL.id })
  assert.equal('cover' in staged!.data, false)
})

test('applyDetail downloads and ingests the cover when --covers is set and the provider has one', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!
  const withCover: ProviderDetail = { ...DETAIL, cover_url: 'https://example.com/cover.jpg' }

  const pixel = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()
  const fakeFetch: typeof fetch = async () => new Response(pixel, { status: 200 })

  await applyDetail(cli, workspace, game, 'igdb', withCover, true, fakeFetch)
  const staged = workspace.pending.find((entry) => entry.type === 'game.enrich')
  const cover = staged!.data['cover'] as { url: string; sha256: string }
  assert.equal(cover.url, 'https://example.com/cover.jpg')
  assert.match(cover.sha256, /^[0-9a-f]{64}$/)
})

test('applyDetail falls back to the bare URL when the cover download fails, never blocking the metadata', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!
  const withCover: ProviderDetail = { ...DETAIL, cover_url: 'https://example.com/cover.jpg' }
  const brokenFetch: typeof fetch = async () => new Response('not an image', { status: 200 })

  await applyDetail(cli, workspace, game, 'igdb', withCover, true, brokenFetch)
  const staged = workspace.pending.find((entry) => entry.type === 'game.enrich')
  assert.deepEqual(staged!.data['cover'], { url: 'https://example.com/cover.jpg' })
})

test('applyDetail never spends a network call on a cover the fold would discard anyway (source: user)', async () => {
  const cli = fakeCli()
  const events = [
    event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' }),
    event('game.cover', { game_id: 'G1', sha256: 'a'.repeat(64), source: 'user' }),
  ]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!
  const withCover: ProviderDetail = { ...DETAIL, cover_url: 'https://example.com/cover.jpg' }
  let called = false
  const spyFetch: typeof fetch = async () => {
    called = true
    return new Response('', { status: 200 })
  }

  await applyDetail(cli, workspace, game, 'igdb', withCover, true, spyFetch)
  assert.equal(called, false)
  const staged = workspace.pending.find((entry) => entry.type === 'game.enrich')
  assert.equal('cover' in staged!.data, false)
})

/** A game with one recorded run on `platform` — the user-authored signal `findDetail` reads for narrowing. */
function gameWithPlatform(platform: string): Workspace {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'pac-man', title: 'Pac-Man' }),
    event('run.import', {
      run_id: 'R1',
      game_id: 'G1',
      platform,
      form: 'physical',
      mode: 'solo',
      started_on: '2026-01-01',
      ended_on: '2026-01-01',
      date_precision: 'day',
      outcome: 'finished',
      completion_criteria: 'enough',
      replay: false,
    }),
  ]
  return { events, state: fold(events, timeContext), pending: [] }
}

test('a recorded run platform narrows multiple exact-title matches down to one, and auto-resolves', async () => {
  const cli = fakeCli()
  const workspace = gameWithPlatform('Atari 2600')
  const game = workspace.state.games[0]!

  const pacManCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: '1', title: 'Pac-Man', year: 1980, platforms: ['Arcade'], cover_url: null },
    { id: '2', title: 'Pac-Man', year: 1982, platforms: ['Atari 2600'], cover_url: null },
    { id: '3', title: 'Pac-Man', year: 1993, platforms: ['Game Boy'], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: pacManCandidates,
    findExact: pacManCandidates,
    fetch: async (id: string) => {
      assert.equal(id, '2', 'must fetch only the platform-matching candidate')
      return {
        id: '2',
        fields: { title: 'Pac-Man', release_year: 1982, developer: null, publisher: null, genres: [], platforms: ['Atari 2600'] },
        cover_url: null,
      }
    },
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })
})

test('two candidates matching the recorded platform stay ambiguous, sorted first', async () => {
  const cli = fakeCli()
  const workspace = gameWithPlatform('Atari')
  const game = workspace.state.games[0]!

  const arcade = { id: '1', title: 'Pac-Man', year: 1980, platforms: ['Arcade'], cover_url: null }
  const atari2600 = { id: '2', title: 'Pac-Man', year: 1982, platforms: ['Atari 2600'], cover_url: null }
  const atari5200 = { id: '3', title: 'Pac-Man', year: 1982, platforms: ['Atari 5200'], cover_url: null }

  const threePlatformCandidates = async (): Promise<ProviderCandidate[]> => [arcade, atari2600, atari5200]
  const igdb: Provider = {
    name: 'igdb',
    search: threePlatformCandidates,
    findExact: threePlatformCandidates,
    fetch: async () => {
      throw new Error('must not be called: still ambiguous, never guessed')
    },
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false)
  assert.equal(outcome.kind, 'ambiguous')
  if (outcome.kind === 'ambiguous') {
    assert.deepEqual(outcome.candidates, [atari2600, atari5200, arcade])
  }
})

test('a recorded platform matching no candidate falls back to the full, unfiltered list', async () => {
  const cli = fakeCli()
  const workspace = gameWithPlatform('Commodore 64')
  const game = workspace.state.games[0]!

  const candidates: ProviderCandidate[] = [
    { id: '1', title: 'Pac-Man', year: 1980, platforms: ['Arcade'], cover_url: null },
    { id: '2', title: 'Pac-Man', year: 1982, platforms: ['Atari 2600'], cover_url: null },
  ]

  const igdb: Provider = {
    name: 'igdb',
    search: async () => candidates,
    findExact: async () => candidates,
    fetch: async () => {
      throw new Error('must not be called: nothing matches, stays ambiguous')
    },
  }

  const outcome = await enrichGame(cli, workspace, game, [igdb], false, false)
  assert.deepEqual(outcome, { kind: 'ambiguous', provider: 'igdb', candidates })
})
