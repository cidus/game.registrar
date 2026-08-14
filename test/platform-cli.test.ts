/**
 * Platform, end to end through the real binary (docs/spec/02-cli.md "Platform,
 * when a run closes" and "Platform vocabulary").
 *
 * Every invocation here is non-interactive, which is what an agent behind a
 * pipe gets — and the point of most of these tests is what happens *without* a
 * prompt to fall back on.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

type Run = { status: number; json: Record<string, unknown>; stdout: string; stderr: string }

function vault(config: Record<string, unknown> = {}): string {
  const root = join(tempDir('gamereg-platform-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', day_cutoff: '05:00', ...config }),
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

const events = (root: string): Record<string, unknown>[] =>
  readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

const config = (root: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, 'gamereg.config.json'), 'utf8')) as Record<string, unknown>

/**
 * A game the catalog knows about, without going near a provider: the
 * `game.enrich` line is exactly what a real `enrich` would have left behind.
 */
function enriched(root: string, title: string, platforms: string[]): void {
  gamereg(root, 'start', title, '--no-metadata', '--at', '2026-05-03 20:00')
  const created = events(root).find((event) => event['type'] === 'game.create')!
  const gameId = (created['data'] as Record<string, unknown>)['game_id']

  const file = join(root, 'data', 'events.jsonl')
  const line = JSON.stringify({
    id: '01K5A0000000000000000ENRICH',
    ts: '2026-05-03T20:30:00-03:00',
    type: 'game.enrich',
    source: 'cli',
    schema: 1,
    data: { game_id: gameId, provider: 'igdb', fields: { platforms } },
  })
  writeFileSync(file, `${readFileSync(file, 'utf8')}${line}\n`)
}

test('a spelling is canonicalized on the way in, and the log keeps what was typed', () => {
  const root = vault()
  const started = gamereg(root, 'start', 'chrono trigger', '--platform', 'snes', '--no-metadata')
  assert.equal(result(started)['platform'], 'Super Nintendo')
  assert.equal(result(started)['platform_source'], 'flag')

  const opened = events(root).find((event) => event['type'] === 'run.open')!
  assert.equal((opened['data'] as Record<string, unknown>)['platform'], 'Super Nintendo')
})

test('a platform nobody has heard of is recorded as typed', () => {
  const root = vault()
  const started = gamereg(root, 'start', 'zelda', '--platform', 'Odyssey 2', '--no-metadata')
  assert.equal(result(started)['platform'], 'Odyssey 2')
})

test('closing with --platform amends the run.open, and appends rather than rewrites', () => {
  const root = vault()
  gamereg(root, 'start', 'hollow knight', '--no-metadata', '--at', '2026-05-03 20:00')
  const opened = events(root).find((event) => event['type'] === 'run.open')!

  const ended = gamereg(root, 'end', '--platform', 'switch', '--at', '2026-05-03 22:00')
  assert.equal(ended.status, 0)
  assert.equal(result(ended)['platform'], 'Nintendo Switch')
  assert.equal(result(ended)['platform_source'], 'flag')

  const amend = events(root).find((event) => event['type'] === 'event.amend')!
  const data = amend['data'] as Record<string, unknown>
  assert.equal(data['target'], opened['id'])
  assert.deepEqual(data['patch'], { platform: 'Nintendo Switch' })
  // The original line is still the original line.
  assert.equal((opened['data'] as Record<string, unknown>)['platform'], undefined)
})

test('one platform in common with the catalog settles it, and says it was inferred', () => {
  const root = vault({ platforms: ['PlayStation 5'] })
  enriched(root, 'hades', ['PlayStation 5', 'Nintendo Switch', 'PC'])

  const ended = gamereg(root, 'end', '--at', '2026-05-03 22:00')
  assert.equal(result(ended)['platform'], 'PlayStation 5')
  assert.equal(result(ended)['platform_source'], 'intersection')
})

test('two platforms in common leave it unknown, and still close the session', () => {
  const root = vault({ platforms: ['PlayStation 5', 'Nintendo Switch'] })
  enriched(root, 'hades', ['PlayStation 5', 'Nintendo Switch', 'PC'])

  const ended = gamereg(root, 'end', '--at', '2026-05-03 22:00')
  // Not exit 3: a closed session with an unknown platform is a fact, not an
  // ambiguity to resolve.
  assert.equal(ended.status, 0)
  assert.equal(result(ended)['platform'], null)
  assert.equal(result(ended)['platform_source'], undefined)
  assert.equal(
    events(root).some((event) => event['type'] === 'event.amend'),
    false,
  )
})

test('finish settles the platform too, and drop accepts the flag', () => {
  const root = vault({ platforms: ['PC'] })
  enriched(root, 'celeste', ['PC', 'Nintendo Switch'])
  const finished = gamereg(root, 'finish', 'celeste', '--rating', '9', '--at', '2026-05-03 22:00')
  assert.equal(result(finished)['platform'], 'PC')
  assert.equal(result(finished)['platform_source'], 'intersection')

  gamereg(root, 'start', 'tunic', '--no-metadata', '--at', '2026-05-04 20:00')
  const dropped = gamereg(root, 'drop', 'tunic', '--platform', 'steam deck', '--at', '2026-05-04 21:00')
  assert.equal(result(dropped)['platform'], 'Steam Deck')
  assert.equal(result(dropped)['platform_source'], 'flag')
})

test('a run that already has a platform is left alone by the fallback', () => {
  const root = vault({ platforms: ['PlayStation 5'] })
  enriched(root, 'hades', ['PlayStation 5', 'PC'])
  gamereg(root, 'end', '--at', '2026-05-03 21:00')

  gamereg(root, 'start', 'hades', '--at', '2026-05-04 20:00')
  const ended = gamereg(root, 'end', '--at', '2026-05-04 21:00')
  assert.equal(result(ended)['platform'], 'PlayStation 5')
  // The second session inherited it from the run; nothing new was settled.
  assert.equal(result(ended)['platform_source'], undefined)
  assert.equal(events(root).filter((event) => event['type'] === 'event.amend').length, 1)
})

test('past never prompts and never fails: a historical run may simply have none', () => {
  const root = vault()
  const filed = gamereg(root, 'past', 'chrono trigger', '--ended', '2011-07', '--no-metadata')
  assert.equal(filed.status, 0)

  const imported = events(root).find((event) => event['type'] === 'run.import')!
  assert.equal((imported['data'] as Record<string, unknown>)['platform'], undefined)
})

test('platform add stores the name typed, with the built-in synonyms attached', () => {
  const root = vault()
  const added = gamereg(root, 'platform', 'add', 'PlayStation 5')
  assert.equal(added.status, 0)
  assert.deepEqual(config(root)['platforms'], [{ name: 'PlayStation 5', aliases: ['PS5'] }])

  // Explicit synonyms replace the guesswork entirely.
  gamereg(root, 'platform', 'add', 'Mega Drive', 'Genesis', 'MD')
  assert.deepEqual((config(root)['platforms'] as unknown[])[1], {
    name: 'Mega Drive',
    aliases: ['Genesis', 'MD'],
  })

  // Never a second entry for one machine: adding one of its own spellings
  // renames it and keeps the old name resolving.
  gamereg(root, 'platform', 'add', 'Genesis')
  assert.equal((config(root)['platforms'] as unknown[]).length, 2)
  assert.deepEqual((config(root)['platforms'] as unknown[])[1], {
    name: 'Genesis',
    aliases: ['Mega Drive', 'MD'],
  })
})

test('platform remove is a no-op when absent, and never touches the log', () => {
  const root = vault()
  gamereg(root, 'platform', 'add', 'Wii')
  gamereg(root, 'start', 'zelda', '--platform', 'Wii', '--no-metadata')

  const absent = gamereg(root, 'platform', 'remove', 'Dreamcast')
  assert.equal(absent.status, 0)
  assert.equal(result(absent)['removed'], false)

  const removed = gamereg(root, 'platform', 'remove', 'Wii')
  assert.equal(result(removed)['removed'], true)
  assert.deepEqual(config(root)['platforms'], [])
  // The run keeps the platform it was recorded on.
  const opened = events(root).find((event) => event['type'] === 'run.open')!
  assert.equal((opened['data'] as Record<string, unknown>)['platform'], 'Wii')
})

test('platform list reports the synonyms and how many runs are behind each', () => {
  const root = vault()
  gamereg(root, 'platform', 'add', 'Nintendo Switch')
  gamereg(root, 'start', 'celeste', '--platform', 'switch', '--no-metadata')

  const listed = gamereg(root, 'platform', 'list')
  assert.deepEqual(result(listed)['platforms'], [
    { platform: 'Nintendo Switch', aliases: ['Switch', 'NSW', 'Switch 1'], runs: 1 },
  ])
})

test('a name added later fixes the whole history, with no amend and no rewrite', () => {
  const root = vault({ build: { targets: ['obsidian'] } })
  // Typed in a hurry, and the built-in table has never heard of this console.
  gamereg(root, 'start', 'gex', '--platform', '3do', '--no-metadata', '--at', '2026-05-03 20:00')
  gamereg(root, 'finish', 'gex', '--at', '2026-05-03 22:00')

  gamereg(root, 'platform', 'add', '3DO')
  gamereg(root, 'build')

  const note = readFileSync(join(root, 'games', 'gex.md'), 'utf8')
  assert.match(note, /^platform: 3DO$/m)
  // The log still says what was typed. Non-negotiable 1.
  const opened = events(root).find((event) => event['type'] === 'run.open')!
  assert.equal((opened['data'] as Record<string, unknown>)['platform'], '3do')
  assert.equal(
    events(root).some((event) => event['type'] === 'event.amend'),
    false,
  )
})

test('a run with no platform renders as absence, never as an empty claim', () => {
  const root = vault({ build: { targets: ['obsidian'] } })
  gamereg(root, 'start', 'tunic', '--no-metadata', '--at', '2026-05-03 20:00')
  gamereg(root, 'end', '--at', '2026-05-03 22:00')
  gamereg(root, 'build')

  const note = readFileSync(join(root, 'games', 'tunic.md'), 'utf8')
  assert.equal(/^platform:/m.test(note), false)
})
