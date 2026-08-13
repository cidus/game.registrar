/**
 * LIVE network smoke test for provider matching — NOT part of `npm test`.
 *
 * `package.json`'s "test" script only matches `test/**\/*.test.ts`; this file
 * deliberately doesn't end in `.test.ts` so `node --test` never picks it up
 * by accident. Run it explicitly with `npm run test:live`.
 *
 * WHY THIS EXISTS: CLAUDE.md's testing strategy is "no network in unit
 * tests, ever" — for good reason, mocked providers can't be wrong about what
 * a real catalog actually looks like. That's exactly how a bug shipped
 * silently: IGDB carries "Final Fantasy VII Remake: Deluxe Edition" as its
 * own catalog entry with its own id, not looser phrasing of the base game,
 * and every mocked test in the regular suite was written by hand — so none
 * of them happened to reproduce that shape. This file hits the real API
 * instead, specifically to catch the next surprise like that one.
 *
 * WHEN TO RUN THIS: whenever you touch `normalize()` (src/resolve/normalize.ts),
 * `findDetail`/`enrichGame` (src/cli/commands/enrich.ts), or a provider's
 * `search`/`fetch` (src/providers/igdb.ts, src/providers/rawg.ts). A green
 * `npm test` does not mean matching still works against a real catalog —
 * only this does. If you don't have credentials configured, that's fine:
 * every test below skips itself, cleanly, and says so.
 *
 * CREDENTIALS: reads example-vault/gamereg.secrets.json (gitignored, never
 * committed — see .gitignore's exception for example-vault/data/log.db,
 * which does NOT cover this file) or IGDB_CLIENT_ID/IGDB_CLIENT_SECRET/
 * RAWG_API_KEY in the environment. Never writes to the committed
 * example-vault: everything here runs against a throwaway copy.
 *
 * If a test that used to pass here starts failing, it is not necessarily a
 * regression in this codebase — a provider's catalog can change (a game
 * gets renamed, re-released, delisted). Read the failure before assuming
 * the fix broke; it might be the world that changed instead.
 */
import assert from 'node:assert/strict'
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { enrichGame } from '../../src/cli/commands/enrich.ts'
import type { Cli } from '../../src/cli/context.ts'
import type { Workspace } from '../../src/cli/workspace.ts'
import { readEvents } from '../../src/core/events.ts'
import { fold, type GameState } from '../../src/core/fold.ts'
import { PROVIDER_CREDENTIAL_FIELDS, resolveProviderCredentials } from '../../src/core/secrets.ts'
import { nowIn } from '../../src/core/time.ts'
import { openVault, timeContext, type Vault } from '../../src/core/vault.ts'
import { translator } from '../../src/i18n/index.ts'
import { createIgdbProvider } from '../../src/providers/igdb.ts'
import { createRawgProvider } from '../../src/providers/rawg.ts'
import { event, tempDir } from '../helpers.ts'

const EXAMPLE = join(import.meta.dirname, '..', '..', 'example-vault')

/** A throwaway copy — this file must never write to the committed fixture. */
function liveVault(): Vault {
  const dir = join(tempDir('gamereg-live-'), 'vault')
  cpSync(EXAMPLE, dir, { recursive: true })
  rmSync(join(dir, '.gamereg'), { recursive: true, force: true })
  return openVault(dir)
}

function fakeCli(vault: Vault): Cli {
  const time = timeContext(vault)
  const bundle = translator('en')
  const now = nowIn(time)
  return {
    vault,
    time,
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

function workspaceOf(vault: Vault): Workspace {
  const events = readEvents(vault.eventsFile)
  return { events, state: fold(events, timeContext(vault)), pending: [] }
}

function gameNamed(workspace: Workspace, slug: string): GameState {
  const game = workspace.state.games.find((candidate) => candidate.slug === slug)
  assert.ok(game, `example-vault fixture is missing the "${slug}" game — did it get renamed?`)
  return game!
}

const vault = liveVault()
const igdb = resolveProviderCredentials(vault.root, 'igdb', PROVIDER_CREDENTIAL_FIELDS.igdb)
const rawg = resolveProviderCredentials(vault.root, 'rawg', PROVIDER_CREDENTIAL_FIELDS.rawg)

const skipIgdb = igdb.ok ? false : 'IGDB credentials not configured (IGDB_CLIENT_ID/IGDB_CLIENT_SECRET, or example-vault/gamereg.secrets.json)'
const skipRawg = rawg.ok ? false : 'RAWG credentials not configured (RAWG_API_KEY, or example-vault/gamereg.secrets.json)'

test('igdb: well-known games with a single clean catalog entry auto-enrich', { skip: skipIgdb }, async () => {
  const cli = fakeCli(vault)
  const workspace = workspaceOf(vault)
  const provider = createIgdbProvider(vault.root)

  for (const slug of ['outer-wilds', 'celeste']) {
    const outcome = await enrichGame(cli, workspace, gameNamed(workspace, slug), [provider], false)
    assert.equal(outcome.kind, 'enriched', `${slug}: ${JSON.stringify(outcome)}`)
  }
})

test(
  'igdb: a title that also exists as a provider-only "Deluxe Edition" entry still auto-matches',
  { skip: skipIgdb },
  async () => {
    // Regression for the bug this file exists because of: IGDB genuinely
    // carries "Final Fantasy VII Remake: Deluxe Edition" as its own entry —
    // stripping the edition suffix during provider matching used to collapse
    // it onto the base game and turn one confident match into a false
    // ambiguity (see 03-resolution.md, "Rule 6 does not apply...").
    const cli = fakeCli(vault)
    const events = [
      ...readEvents(vault.eventsFile),
      event('game.create', { game_id: 'LIVE-FF7R', slug: 'ff7r-live', title: 'Final Fantasy VII Remake' }),
    ]
    const workspace: Workspace = { events, state: fold(events, timeContext(vault)), pending: [] }
    const provider = createIgdbProvider(vault.root)

    const outcome = await enrichGame(cli, workspace, gameNamed(workspace, 'ff7r-live'), [provider], false)
    assert.equal(outcome.kind, 'enriched', JSON.stringify(outcome))
  },
)

test(
  'igdb: catalog entries that genuinely share a title stay ambiguous, never guessed',
  { skip: skipIgdb },
  async () => {
    // As of writing, IGDB has more than one entry titled exactly "Hollow
    // Knight" and exactly "Chrono Trigger" (different platform releases).
    // If IGDB ever deduplicates these, this test starts asserting the wrong
    // thing — that is a catalog change, not a regression here.
    const cli = fakeCli(vault)
    const workspace = workspaceOf(vault)
    const provider = createIgdbProvider(vault.root)

    for (const slug of ['hollow-knight', 'chrono-trigger']) {
      const outcome = await enrichGame(cli, workspace, gameNamed(workspace, slug), [provider], false)
      assert.equal(outcome.kind, 'skipped', `${slug}: ${JSON.stringify(outcome)} — did IGDB dedupe its entries?`)
    }
  },
)

test('rawg: a well-known game auto-enriches', { skip: skipRawg }, async () => {
  const cli = fakeCli(vault)
  const workspace = workspaceOf(vault)
  const provider = createRawgProvider(vault.root)

  const outcome = await enrichGame(cli, workspace, gameNamed(workspace, 'celeste'), [provider], false)
  assert.equal(outcome.kind, 'enriched', JSON.stringify(outcome))
})
