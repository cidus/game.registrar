/**
 * `start <query> --id <provider>:<id>` when nothing local matches yet.
 *
 * Trusted, not searched: a write command never touches the network
 * (00-architecture.md invariant 5), so a provider ref with no local match is
 * taken on faith — the caller (a human picking a code-3 candidate, or an
 * agent re-invoking after `gamereg search`) already did the looking-up. The
 * game is created from the query text as its title and the ref as its
 * providers entry; `gamereg enrich` fills in the rest later, from the id
 * already on record.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

type Run = { status: number; json: Record<string, unknown>; stdout: string; stderr: string }

function vault(): string {
  const root = join(tempDir('gamereg-provider-id-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', day_cutoff: '05:00' }),
  )
  return root
}

function gamereg(root: string, ...args: string[]): Run {
  const result = spawnSync(process.execPath, [MAIN, '--vault', root, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1', NO_COLOR: '1' },
  })
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

test('a provider ref with no local match creates a game from the query text, no network', () => {
  const root = vault()
  const run = gamereg(root, 'start', 'Hollow Knight', '--id', 'igdb:7346', '--platform', 'Switch', '--at', '2026-05-03 20:00')
  assert.equal(run.status, 0, run.stdout)

  const status = gamereg(root, 'status', '--id', 'igdb:7346')
  assert.equal(status.status, 0)
  const game = result(status)['game'] as { title: string }
  assert.equal(game.title, 'Hollow Knight')
})

test('the providers entry is recorded, ready for enrich to find by id directly', () => {
  const root = vault()
  gamereg(root, 'start', 'Hollow Knight', '--id', 'igdb:7346', '--platform', 'Switch', '--at', '2026-05-03 20:00')

  const log = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line: string) => JSON.parse(line) as { type: string; data: Record<string, unknown> })
  const created = log.find((event) => event.type === 'game.create')
  assert.deepEqual(created?.data['providers'], { igdb: '7346' })
})

test('a second invocation with the same provider ref resolves the game already created — still no network', () => {
  const root = vault()
  gamereg(root, 'start', 'Hollow Knight', '--id', 'igdb:7346', '--platform', 'Switch', '--at', '2026-05-03 20:00')
  gamereg(root, 'end', '--at', '2026-05-03 21:00')

  const again = gamereg(root, 'start', 'Hollow Knight', '--id', 'igdb:7346', '--platform', 'Switch', '--at', '2026-05-04 20:00')
  assert.equal(again.status, 0)

  const status = gamereg(root, 'status')
  assert.equal(result(status)['games'], 1)
})

test('a game: reference that does not exist is still a hard not_found — no leniency for a supposedly-known ULID', () => {
  const root = vault()
  const run = gamereg(root, 'start', 'Hollow Knight', '--id', 'game:01K0000000000000000000000', '--platform', 'Switch')
  assert.equal(run.status, 4)
  assert.equal(run.json['error'], 'not_found')
})

test('a provider ref cannot create a game on a command that never creates (finish)', () => {
  const root = vault()
  const run = gamereg(root, 'finish', 'Hollow Knight', '--id', 'igdb:7346', '--rating', '9', '--criteria', 'credits')
  assert.equal(run.status, 4)
  assert.equal(run.json['error'], 'not_found')
})
