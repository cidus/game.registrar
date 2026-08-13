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

import { tempDir } from './helpers.ts'

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

/** No IGDB_ / RAWG_ variables left over from the host environment, and no secrets file. */
function gamereg(root: string, ...args: string[]): Run {
  const env: Record<string, string | undefined> = { ...process.env, GAMEREG_NON_INTERACTIVE: '1', NO_COLOR: '1' }
  for (const key of Object.keys(env)) {
    if (key.startsWith('IGDB_') || key.startsWith('RAWG_')) delete env[key]
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

test('with no --provider, both igdb and rawg are tried before failing', () => {
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
