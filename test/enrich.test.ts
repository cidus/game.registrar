/**
 * `gamereg enrich` — end-to-end, through the real binary (docs/spec/02-cli.md).
 *
 * No test here ever reaches the network: every case exercises credential
 * resolution failing before any provider is called (no secrets file, no env
 * vars), which is enough to exercise the whole exit-6 path without a socket.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { enrichGame } from '../src/cli/commands/enrich.ts'
import type { Cli } from '../src/cli/context.ts'
import type { Workspace } from '../src/cli/workspace.ts'
import { appendEvents, makeEvent } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { nowIn } from '../src/core/time.ts'
import { openVault } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import type { Provider, ProviderCandidate } from '../src/providers/provider.ts'
import { context as timeContext, event, tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

type Run = { status: number; json: Record<string, unknown>; stdout: string; stderr: string }

function vault(): string {
  const root = join(tempDir('gamereg-enrich-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', day_cutoff: '05:00' }),
  )
  return root
}

/** No IGDB_ variables left over from the host environment, and no secrets file. */
function gamereg(root: string, ...args: string[]): Run {
  const env: Record<string, string | undefined> = { ...process.env, GAMEREG_NON_INTERACTIVE: '1', NO_COLOR: '1' }
  for (const key of Object.keys(env)) {
    if (key.startsWith('IGDB_')) delete env[key]
  }
  const result = spawnSync(process.execPath, [MAIN, '--vault', root, '--json', ...args], { encoding: 'utf8', env })
  const stdout = result.stdout ?? ''
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(stdout.trim()) as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: result.status ?? 1, json, stdout, stderr: result.stderr ?? '' }
}

const result = (run: Run): Record<string, unknown> => run.json['result'] as Record<string, unknown>

function seedGame(root: string, title: string): void {
  const run = gamereg(root, 'start', title, '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  assert.equal(run.status, 0, run.stdout)
}

test('an unknown --provider is a usage error listing the valid ones', () => {
  const root = vault()
  const run = gamereg(root, 'enrich', 'anything', '--provider', 'nonsense')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
  assert.match(String(run.json['message']), /igdb/)
})

test('no query and no --all is not_found — nothing to resolve', () => {
  const root = vault()
  const run = gamereg(root, 'enrich')
  assert.equal(run.status, 4)
})

test('a game with no local match is not_found, same as every other resolving command', () => {
  const root = vault()
  const run = gamereg(root, 'enrich', 'nothing on record')
  assert.equal(run.status, 4)
  assert.equal(run.json['error'], 'not_found')
})

test('--all with an empty vault says there is nothing to enrich, and writes nothing', () => {
  const root = vault()
  const run = gamereg(root, 'enrich', '--all')
  assert.equal(run.status, 0)
  assert.deepEqual(result(run), { enriched: [], skipped: [], failed: [] })
  assert.equal(existsSync(join(root, 'data', 'events.jsonl')), false)
})

test('missing credentials fail with code 6, naming the missing env var, and write nothing', () => {
  const root = vault()
  seedGame(root, 'hollow knight')

  const before = existsSync(join(root, 'data', 'events.jsonl'))
    ? readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
    : ''

  const run = gamereg(root, 'enrich', 'hollow knight', '--provider', 'igdb')
  assert.equal(run.status, 6)
  assert.equal(run.json['error'], 'provider_unavailable')
  const failed = result(run)['failed'] as { message: string }[]
  assert.equal(failed.length, 1)
  assert.match(failed[0]!.message, /IGDB_CLIENT_ID/)

  const after = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
  assert.equal(after, before)
})

test('with no --provider, the default chain is tried before failing', () => {
  const root = vault()
  seedGame(root, 'chrono trigger')

  const run = gamereg(root, 'enrich', 'chrono trigger')
  assert.equal(run.status, 6)
  assert.equal((result(run)['failed'] as unknown[]).length, 1)
})

test('--covers alone, with no query and no --all, is still not_found', () => {
  const root = vault()
  const run = gamereg(root, 'enrich', '--covers')
  assert.equal(run.status, 4)
})

test('--match combined with --all is a usage error', () => {
  const root = vault()
  const run = gamereg(root, 'enrich', '--all', '--match', 'igdb:7346')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('--match with a malformed ref (not provider:id) is a usage error', () => {
  const root = vault()
  seedGame(root, 'hollow knight')
  const run = gamereg(root, 'enrich', 'hollow knight', '--match', 'not-a-ref')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('--match naming an unknown provider is a usage error listing the valid ones', () => {
  const root = vault()
  seedGame(root, 'hollow knight')
  const run = gamereg(root, 'enrich', 'hollow knight', '--match', 'nonsense:1')
  assert.equal(run.status, 2)
  assert.match(String(run.json['message']), /igdb/)
})

test('--match still goes through normal credential resolution — no bypass', () => {
  const root = vault()
  seedGame(root, 'hollow knight')
  const run = gamereg(root, 'enrich', 'hollow knight', '--match', 'igdb:11169')
  assert.equal(run.status, 6)
  assert.equal(run.json['error'], 'provider_unavailable')
})

/**
 * Writes a `game.enrich` event directly to the log — no provider call, no
 * credentials needed — so a fixture can have an "already enriched" game
 * without ever reaching the network.
 */
function markEnriched(root: string, gameId: string, provider = 'igdb'): void {
  const eventsFile = join(root, 'data', 'events.jsonl')
  appendEvents(eventsFile, [
    makeEvent('game.enrich', { game_id: gameId, provider, fields: { id: '1', title: 'placeholder' } }),
  ])
}

function gameId(root: string, title: string): string {
  const run = gamereg(root, 'start', title, '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  assert.equal(run.status, 0, run.stdout)
  const game = result(run)['game'] as { game_id: string }
  return game.game_id
}

test('--missing selects only games with no provider reference, and never touches the network for the rest', () => {
  const root = vault()
  const enrichedId = gameId(root, 'hollow knight')
  markEnriched(root, enrichedId)
  gameId(root, 'chrono trigger')

  // No credentials configured: if the already-enriched game were reselected
  // and its provider called, this would exit 6 (provider_unavailable). It
  // must instead only ever try "chrono trigger", the one without a ref.
  const run = gamereg(root, 'enrich', '--missing')
  assert.equal(run.status, 6)
  const failed = result(run)['failed'] as { title: string }[]
  assert.equal(failed.length, 1)
  assert.equal(failed[0]!.title, 'chrono trigger')
})

test('--missing with every game already enriched selects nothing and writes no event', () => {
  const root = vault()
  const enrichedId = gameId(root, 'hollow knight')
  markEnriched(root, enrichedId)

  const before = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
  const run = gamereg(root, 'enrich', '--missing')
  assert.equal(run.status, 0)
  assert.deepEqual(result(run), { enriched: [], skipped: [], failed: [] })
  assert.equal(readFileSync(join(root, 'data', 'events.jsonl'), 'utf8'), before)
})

test('--missing --all is a usage error', () => {
  const root = vault()
  const run = gamereg(root, 'enrich', '--missing', '--all')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('--missing --match <ref> is a usage error', () => {
  const root = vault()
  const run = gamereg(root, 'enrich', '--missing', '--match', 'igdb:7346')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('--missing with a positional query is a usage error', () => {
  const root = vault()
  const run = gamereg(root, 'enrich', '--missing', 'hollow knight')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

/** Same fakeCli shape as enrich-fallback.test.ts, needed here for the direct enrichGame(..., bulk) check below. */
function fakeCli(): Cli {
  const v = openVault(tempDir())
  const bundle = translator('en')
  const now = nowIn(timeContext)
  return {
    vault: v,
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

test('--missing inherits bulk mode: an ambiguous provider match collapses to skipped, never exit 3', async () => {
  // `--missing` is a sibling selector of `--all` and must pass the same
  // `bulk = true` into enrichGame — this is what makes it safe to run from
  // cron (docs/spec/02-cli.md): an ambiguous match during an unattended
  // `--missing` run is left unresolved, not turned into a question nobody is
  // there to answer.
  const cli = fakeCli()
  const events = [event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' })]
  const workspace: Workspace = { events, state: fold(events, timeContext), pending: [] }
  const game = workspace.state.games[0]!

  const ambiguousCandidates = async (): Promise<ProviderCandidate[]> => [
    { id: '1', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
    { id: '2', title: 'Hollow Knight', year: 2017, platforms: [], cover_url: null },
  ]
  const igdb: Provider = {
    name: 'igdb',
    search: ambiguousCandidates,
    findExact: ambiguousCandidates,
    fetch: async () => {
      throw new Error('must not be called: bulk mode never resolves an ambiguity')
    },
  }

  // The `bulk` argument here is exactly what the CLI's `--missing` branch
  // passes: `options.all === true || options.missing === true`.
  const outcome = await enrichGame(cli, workspace, game, [igdb], false, true)
  assert.deepEqual(outcome, { kind: 'skipped' })
})

test('--missing --covers does not select a game that has metadata but no cover', () => {
  // The limitation this flag deliberately does not cover: "missing" means no
  // provider metadata, not "missing a cover". A game enriched before
  // --covers existed has metadata and no cover, and must not be reselected.
  const root = vault()
  const enrichedId = gameId(root, 'hollow knight')
  markEnriched(root, enrichedId)

  const before = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
  const run = gamereg(root, 'enrich', '--missing', '--covers')
  assert.equal(run.status, 0)
  assert.deepEqual(result(run), { enriched: [], skipped: [], failed: [] })
  assert.equal(readFileSync(join(root, 'data', 'events.jsonl'), 'utf8'), before)
})
