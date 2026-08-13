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

import type { Cli } from '../src/cli/context.ts'
import { enrichGame } from '../src/cli/commands/enrich.ts'
import type { Workspace } from '../src/cli/workspace.ts'
import { GameregError } from '../src/core/errors.ts'
import { fold } from '../src/core/fold.ts'
import { nowIn } from '../src/core/time.ts'
import { openVault } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import type { Provider, ProviderDetail } from '../src/providers/provider.ts'
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
  return { name, search: fail, fetch: fail }
}

/** A provider that is reachable and answers, but has nothing for this title. */
function noMatch(name: string): Provider {
  return { name, search: async () => [], fetch: async () => null }
}

/** A provider that finds an exact match. */
function matching(name: string, detail: ProviderDetail): Provider {
  return {
    name,
    search: async (query: string) => [
      { id: detail.id, title: query, year: null, platforms: [], cover_url: null },
    ],
    fetch: async () => detail,
  }
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

  const outcome = await enrichGame(cli, workspace, game, [noMatch('igdb'), unavailable('rawg')], false)
  assert.deepEqual(outcome, { kind: 'skipped' })
})

test('the order does not matter: an unavailable provider before a reachable no-match is still skipped', async () => {
  const cli = fakeCli()
  const workspace = fakeWorkspace()
  const game = workspace.state.games[0]!

  const outcome = await enrichGame(cli, workspace, game, [unavailable('rawg'), noMatch('igdb')], false)
  assert.deepEqual(outcome, { kind: 'skipped' })
})

test('every provider unavailable is reported failed, naming every one of them', async () => {
  const cli = fakeCli()
  const workspace = fakeWorkspace()
  const game = workspace.state.games[0]!

  const outcome = await enrichGame(cli, workspace, game, [unavailable('igdb'), unavailable('rawg')], false)
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

  const outcome = await enrichGame(cli, workspace, game, [unavailable('igdb'), matching('rawg', DETAIL)], false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'rawg' })
})

test('a match on the first provider never even asks the second', async () => {
  const cli = fakeCli()
  const workspace = fakeWorkspace()
  const game = workspace.state.games[0]!
  let asked = false
  const spy: Provider = {
    name: 'rawg',
    search: async () => {
      asked = true
      return []
    },
    fetch: async () => null,
  }

  const outcome = await enrichGame(cli, workspace, game, [matching('igdb', DETAIL), spy], false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })
  assert.equal(asked, false)
})

test('a provider title with a trailing (year) still auto-matches the local title', async () => {
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'ff7r', title: 'Final Fantasy VII Remake' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const igdb: Provider = {
    name: 'igdb',
    search: async () => [
      { id: '1234', title: 'Final Fantasy VII Remake (2020)', year: 2020, platforms: [], cover_url: null },
    ],
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

  const outcome = await enrichGame(cli, workspace, game, [igdb], false)
  assert.deepEqual(outcome, { kind: 'enriched', provider: 'igdb' })
})
