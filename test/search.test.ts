/**
 * `gamereg search` — end-to-end (docs/spec/02-cli.md, 03-resolution.md step 6).
 *
 * No test here reaches the network: with no credentials configured, provider
 * search degrades to "no provider results" before any fetch happens, so the
 * fallback path is exercised without a socket.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { matchesPlatformHint, rankByOwnership } from '../src/cli/commands/search.ts'
import { platformTable } from '../src/core/platforms.ts'
import type { Candidate } from '../src/resolve/resolve.ts'
import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

type Run = { status: number; json: Record<string, unknown>; stdout: string; stderr: string }

function vault(): string {
  const root = join(tempDir('gamereg-search-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', day_cutoff: '05:00' }),
  )
  return root
}

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

test('a local match never touches a provider', () => {
  const root = vault()
  assert.equal(gamereg(root, 'start', 'hollow knight', '--platform', 'Switch', '--no-metadata').status, 0)

  const run = gamereg(root, 'search', 'hollow')
  assert.equal(run.status, 0)
  const candidates = result(run)['candidates'] as { source: string }[]
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]!.source, 'local')
})

test('no local match, no provider configured: falls through cleanly to no results', () => {
  const root = vault()
  const run = gamereg(root, 'search', 'something nobody has heard of')
  assert.equal(run.status, 0)
  assert.deepEqual(result(run)['candidates'], [])
})

test('--provider igdb narrows the fallback chain; unconfigured is still no results, not an error', () => {
  const root = vault()
  const run = gamereg(root, 'search', 'something nobody has heard of', '--provider', 'igdb')
  assert.equal(run.status, 0)
  assert.deepEqual(result(run)['candidates'], [])
})

test('an unknown --provider is a usage error listing the valid ones, same as enrich', () => {
  const root = vault()
  const run = gamereg(root, 'search', 'zelda', '--provider', 'nonsense')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
  assert.match(String(run.json['message']), /igdb/)
})

test('--local-only skips the provider fallback and behaves the same with nothing configured', () => {
  const root = vault()
  const run = gamereg(root, 'search', 'something nobody has heard of', '--local-only')
  assert.equal(run.status, 0)
  assert.deepEqual(result(run)['candidates'], [])
})

function candidate(ref: string, platforms: string[]): Candidate {
  return { ref, title: ref, year: null, platforms, source: 'provider', in_log: false }
}

test('rankByOwnership floats the candidate matching config.platforms to the top, order otherwise preserved', () => {
  const table = platformTable([{ name: 'PlayStation 5', aliases: ['PS5'] }])
  const candidates = [
    candidate('a', ['Game Boy Color']),
    candidate('b', ['PlayStation 5', 'PC (Microsoft Windows)']),
    candidate('c', ['Xbox Series X|S']),
  ]

  const ranked = rankByOwnership(candidates, table)
  assert.deepEqual(
    ranked.map((c) => c.ref),
    ['b', 'a', 'c'],
  )
})

test('rankByOwnership is a no-op when nothing is configured, or when nothing matches', () => {
  const empty = platformTable([])
  const candidates = [candidate('a', ['Switch']), candidate('b', ['PC (Microsoft Windows)'])]
  assert.deepEqual(rankByOwnership(candidates, empty).map((c) => c.ref), ['a', 'b'])

  const configured = platformTable([{ name: 'PlayStation 5', aliases: [] }])
  assert.deepEqual(rankByOwnership(candidates, configured).map((c) => c.ref), ['a', 'b'])
})

test('matchesPlatformHint canonicalizes both sides — a provider spelling "PlayStation" still matches "PSX"', () => {
  const table = platformTable()
  assert.equal(matchesPlatformHint({ platforms: ['PlayStation'] }, 'PSX', table), true)
  assert.equal(matchesPlatformHint({ platforms: ['PlayStation 4'] }, 'PSX', table), false)
  assert.equal(matchesPlatformHint({ platforms: ['PlayStation'] }, undefined, table), true)
})
