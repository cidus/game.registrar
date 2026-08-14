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
 * `findDetail`/`enrichGame` (src/cli/commands/enrich.ts), or the provider's
 * `search`/`fetch` (src/providers/igdb.ts). A green `npm test` does not mean
 * matching still works against a real catalog — only this does. If you
 * don't have credentials configured, that's fine: every test below skips
 * itself, cleanly, and says so.
 *
 * CREDENTIALS: reads example-vault/gamereg.secrets.json (gitignored, never
 * committed — see .gitignore's exception for example-vault/data/log.db,
 * which does NOT cover this file) or IGDB_CLIENT_ID/IGDB_CLIENT_SECRET in
 * the environment. Never writes to the committed example-vault: everything
 * here runs against a throwaway copy.
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

import { applyDetail, enrichGame } from '../../src/cli/commands/enrich.ts'
import type { Cli } from '../../src/cli/context.ts'
import type { Workspace } from '../../src/cli/workspace.ts'
import { readEvents } from '../../src/core/events.ts'
import { fold, type GameState } from '../../src/core/fold.ts'
import { PROVIDER_CREDENTIAL_FIELDS, resolveProviderCredentials } from '../../src/core/secrets.ts'
import { nowIn } from '../../src/core/time.ts'
import { openVault, timeContext, type Vault } from '../../src/core/vault.ts'
import { translator } from '../../src/i18n/index.ts'
import { createIgdbProvider } from '../../src/providers/igdb.ts'
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

const skipIgdb = igdb.ok ? false : 'IGDB credentials not configured (IGDB_CLIENT_ID/IGDB_CLIENT_SECRET, or example-vault/gamereg.secrets.json)'

test('igdb: well-known games with a single clean catalog entry auto-enrich', { skip: skipIgdb }, async () => {
  const cli = fakeCli(vault)
  const workspace = workspaceOf(vault)
  const provider = createIgdbProvider(vault.root)

  for (const slug of ['outer-wilds', 'celeste']) {
    const outcome = await enrichGame(cli, workspace, gameNamed(workspace, slug), [provider], false, false)
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

    const outcome = await enrichGame(cli, workspace, gameNamed(workspace, 'ff7r-live'), [provider], false, false)
    assert.equal(outcome.kind, 'enriched', JSON.stringify(outcome))
  },
)

test(
  'igdb: a recorded platform now auto-resolves what used to be ambiguous (Hollow Knight)',
  { skip: skipIgdb },
  async () => {
    // As of writing, IGDB has more than one entry titled exactly "Hollow
    // Knight" (different platform releases). Before platform-narrowing
    // existed, this was ambiguous; the fixture's Hollow Knight has a run
    // recorded on "Switch", which only one of the IGDB entries carries
    // (the other is PlayStation Vita only) — so it now auto-resolves. If
    // IGDB's catalog shape changes, this is a catalog change, not a
    // regression here.
    const cli = fakeCli(vault)
    const workspace = workspaceOf(vault)
    const provider = createIgdbProvider(vault.root)

    const outcome = await enrichGame(cli, workspace, gameNamed(workspace, 'hollow-knight'), [provider], false, false)
    assert.equal(outcome.kind, 'enriched', `hollow-knight: ${JSON.stringify(outcome)} — did IGDB's catalog change?`)
  },
)

test(
  'igdb: an acronym recorded locally narrows a six-way catalog split (Chrono Trigger, SNES)',
  { skip: skipIgdb },
  async () => {
    // IGDB carries six entries titled exactly "Chrono Trigger" — one per
    // release, from Legacy Mobile Device to PlayStation. The fixture's run
    // is recorded on "SNES", which is not a substring of any of those
    // platform names: this used to find nothing, fall back to the full
    // candidate list, and report ambiguous.
    //
    // The platform vocabulary (02-cli.md) is what closes that gap — `SNES`
    // and "Super Nintendo Entertainment System" are one platform, so
    // exactly one candidate survives and it is the right one. This test is
    // the reason the built-in table carries the providers' own spellings.
    const cli = fakeCli(vault)
    const workspace = workspaceOf(vault)
    const provider = createIgdbProvider(vault.root)

    const game = gameNamed(workspace, 'chrono-trigger')
    const outcome = await enrichGame(cli, workspace, game, [provider], false, false)
    assert.equal(outcome.kind, 'enriched', `chrono-trigger: ${JSON.stringify(outcome)}`)

    // Narrowing to *a* candidate is worth nothing if it is the wrong one:
    // the 1995 SNES release, not the 2008 DS or 2018 PC entry.
    const enriched = workspace.state.gamesById.get(game.game_id)!
    assert.equal(enriched.release_year, 1995, `landed on the wrong release: ${enriched.release_year}`)
  },
)

test(
  'igdb: --match fetches an exact candidate id directly, skipping search entirely',
  { skip: skipIgdb },
  async () => {
    const cli = fakeCli(vault)
    const workspace = workspaceOf(vault)
    const provider = createIgdbProvider(vault.root)

    // 11169 is Final Fantasy VII Remake's real IGDB id (confirmed live).
    const detail = await provider.fetch('11169')
    assert.ok(detail, 'IGDB id 11169 should still resolve — did the catalog change?')
    const applied = await applyDetail(cli, workspace, gameNamed(workspace, 'outer-wilds'), provider.name, detail!, false)
    assert.equal(applied.provider, 'igdb')

    const staged = workspace.pending.find((entry) => entry.type === 'game.enrich')
    assert.ok(staged, 'game.enrich event was not staged')
    assert.equal((staged!.data['fields'] as Record<string, unknown>)['id'], '11169')
  },
)

/** A "Pac-Man" game with one recorded run, real events plus a synthetic one, never written to disk. */
function pacManWorkspace(platform: string): Workspace {
  const slug = `pac-man-live-${platform.toLowerCase().replace(/\s+/g, '-')}`
  const events = [
    ...readEvents(vault.eventsFile),
    event('game.create', { game_id: `LIVE-PACMAN-${platform}`, slug, title: 'Pac-Man' }),
    event('run.import', {
      run_id: `LIVE-PACMAN-R1-${platform}`,
      game_id: `LIVE-PACMAN-${platform}`,
      platform,
      form: 'physical',
      mode: 'solo',
      started_on: '2020-01-01',
      ended_on: '2020-01-01',
      date_precision: 'day',
      outcome: 'finished',
      completion_criteria: 'enough',
      replay: false,
    }),
  ]
  return { events, state: fold(events, timeContext(vault)), pending: [] }
}

test(
  'igdb: findExact surfaces an old, low-engagement release that fuzzy search never would (Pac-Man, Atari 2600)',
  { skip: skipIgdb },
  async () => {
    // The regression this test exists for: IGDB's relevance-ranked `search`
    // never surfaces the 1982 Atari 2600 "Pac-Man" port, even at a fetch
    // limit of 50 — confirmed live. A literal `where name = "Pac-Man"`
    // lookup (findExact) finds it immediately, among 53 exact-title
    // entries, so an exact platform match ("Atari 2600") auto-resolves.
    const cli = fakeCli(vault)
    const workspace = pacManWorkspace('Atari 2600')
    const provider = createIgdbProvider(vault.root)

    const outcome = await enrichGame(cli, workspace, gameNamed(workspace, 'pac-man-live-atari-2600'), [provider], false, false)
    assert.equal(outcome.kind, 'enriched', `expected the Atari 2600 release to auto-resolve, got ${JSON.stringify(outcome)}`)
  },
)

test(
  'igdb: a generic recorded platform ("Atari") still can\'t auto-resolve, but puts every Atari release first',
  { skip: skipIgdb },
  async () => {
    // As of writing, IGDB has three "Pac-Man" entries whose platform name
    // contains "atari" (Atari 2600, Atari 5200, Atari 8-bit) — a bare
    // "Atari" recorded locally matches all three, so this stays genuinely
    // ambiguous. What matters is that they're no longer missing from the
    // list at all (the original bug report), and that they lead it.
    const cli = fakeCli(vault)
    const workspace = pacManWorkspace('Atari')
    const provider = createIgdbProvider(vault.root)

    const outcome = await enrichGame(cli, workspace, gameNamed(workspace, 'pac-man-live-atari'), [provider], false, false)
    assert.equal(outcome.kind, 'ambiguous', JSON.stringify(outcome))
    if (outcome.kind === 'ambiguous') {
      const leading = outcome.candidates.slice(0, 3)
      assert.ok(
        leading.every((candidate) => candidate.platforms.some((p) => p.toLowerCase().includes('atari'))),
        `expected the first 3 candidates to all be Atari platforms, got ${JSON.stringify(leading)}`,
      )
    }
  },
)
