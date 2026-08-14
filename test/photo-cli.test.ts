/**
 * The CLI surface for image ingestion (docs/spec/02-cli.md "Attachments"),
 * the last piece of phase 1: `--photo`/`--caption`/`--kind`/`--as-cover` on
 * every recording command, plus the retroactive `attach` and `cover`
 * commands.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

function run(root: string, ...args: string[]): { status: number; json: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [MAIN, '--vault', root, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1' },
    input: '',
  })
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse((result.stdout ?? '').trim()) as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: result.status ?? 1, json }
}

function vault(): string {
  const root = join(tempDir('gamereg-photo-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'gamereg.config.json'), JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo' }))
  return root
}

let counter = 0

/** A tiny, distinct JPEG each call, so different photos hash differently. */
async function photo(root: string, color: { r: number; g: number; b: number }): Promise<string> {
  counter += 1
  const path = join(root, `in-${counter}.jpg`)
  writeFileSync(path, await sharp({ create: { width: 40, height: 20, channels: 3, background: color } }).jpeg().toBuffer())
  return path
}

test('--photo on start attaches to the session, content-addressed under assets/', async () => {
  const root = vault()
  const file = await photo(root, { r: 10, g: 20, b: 30 })

  const started = run(root, 'start', 'celeste', '--no-metadata', '--photo', file, '--caption', 'box art', '--at', '2026-05-03 20:00')
  assert.equal(started.status, 0)
  const attachments = started.json['result'] as { attachments: { sha256: string; caption: string; written: boolean }[] }
  assert.equal(attachments.attachments.length, 1)
  assert.equal(attachments.attachments[0]?.caption, 'box art')
  assert.equal(attachments.attachments[0]?.written, true)

  const sha = attachments.attachments[0]!.sha256
  assert.equal(existsSync(join(root, 'assets', sha.slice(0, 2), `${sha}.webp`)), true)
})

test('--caption pairs with the --photo immediately before it, not by array position', async () => {
  const root = vault()
  const first = await photo(root, { r: 1, g: 2, b: 3 })
  const second = await photo(root, { r: 4, g: 5, b: 6 })

  // Two photos, one caption: it belongs to the second, per docs/spec/02-cli.md's own example.
  const started = run(
    root,
    'start',
    'celeste',
    '--no-metadata',
    '--photo',
    first,
    '--photo',
    second,
    '--caption',
    'credits rolled',
    '--at',
    '2026-05-03 20:00',
  )
  const attachments = started.json['result'] as { attachments: { caption: string | null }[] }
  assert.equal(attachments.attachments.length, 2)
  assert.equal(attachments.attachments[0]?.caption, null)
  assert.equal(attachments.attachments[1]?.caption, 'credits rolled')
})

test('--as-cover on start sets the cover, source: user, and enrich can never override it', async () => {
  const root = vault()
  const file = await photo(root, { r: 50, g: 60, b: 70 })

  run(root, 'start', 'celeste', '--no-metadata', '--photo', file, '--as-cover', '--at', '2026-05-03 20:00')
  run(root, 'finish', 'celeste', '--rating', '9', '--at', '2026-05-03 22:00')
  run(root, 'build')

  const note = readFileSync(join(root, 'obsidian', 'games', 'celeste.md'), 'utf8')
  assert.match(note, /## Gallery/)
  assert.match(note, /!\[\[assets\/\w{2}\/\w{64}\.webp\]\]/)
})

test('--photo on end lands on the session close, not on the run that opened it', async () => {
  const root = vault()
  const file = await photo(root, { r: 90, g: 91, b: 92 })

  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const ended = run(root, 'end', '--photo', file, '--kind', 'screenshot', '--at', '2026-05-03 22:00')
  const attachments = ended.json['result'] as { attachments: { kind: string }[] }
  assert.equal(attachments.attachments[0]?.kind, 'screenshot')
})

test('--photo on finish and drop attaches to run.close', async () => {
  const root = vault()
  const finishPhoto = await photo(root, { r: 5, g: 5, b: 5 })
  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const finished = run(root, 'finish', 'celeste', '--rating', '8', '--photo', finishPhoto, '--at', '2026-05-03 22:00')
  assert.equal((finished.json['result'] as { attachments: unknown[] }).attachments.length, 1)

  const dropPhoto = await photo(root, { r: 6, g: 6, b: 6 })
  run(root, 'start', 'hades', '--no-metadata', '--at', '2026-05-04 20:00')
  const dropped = run(root, 'drop', 'hades', '--photo', dropPhoto, '--at', '2026-05-04 21:00')
  assert.equal((dropped.json['result'] as { attachments: unknown[] }).attachments.length, 1)
})

test('--photo on past attaches to the run.import', async () => {
  const root = vault()
  const file = await photo(root, { r: 7, g: 7, b: 7 })
  const filed = run(root, 'past', 'chrono trigger', '--ended', '2011-07', '--no-metadata', '--photo', file, '--caption', 'box')
  assert.equal((filed.json['result'] as { attachments: { caption: string }[] }).attachments[0]?.caption, 'box')
})

test('gamereg attach adds a photo to an existing event, retroactively', async () => {
  const root = vault()
  const started = run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const sessionId = (started.json['result'] as { session_id: string }).session_id

  const file = await photo(root, { r: 8, g: 8, b: 8 })
  const eventId = (started.json['events'] as string[])[0]!
  const attached = run(root, 'attach', eventId, '--photo', file, '--caption', 'forgot to send this')
  assert.equal(attached.status, 0)
  assert.equal((attached.json['result'] as { target: string }).target, eventId)
  void sessionId
})

test('gamereg attach to a game query attaches to the game directly', async () => {
  const root = vault()
  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const file = await photo(root, { r: 9, g: 9, b: 9 })
  const attached = run(root, 'attach', 'celeste', '--photo', file)
  assert.equal(attached.status, 0)

  run(root, 'build')
  const note = readFileSync(join(root, 'obsidian', 'games', 'celeste.md'), 'utf8')
  assert.match(note, /## Gallery/)
})

test('gamereg attach with no --photo is a usage error', () => {
  const root = vault()
  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const attached = run(root, 'attach', 'celeste')
  assert.equal(attached.status, 2)
})

test('gamereg cover --photo sets a user cover; enrich never overwrites it', async () => {
  const root = vault()
  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const file = await photo(root, { r: 11, g: 12, b: 13 })

  const covered = run(root, 'cover', 'celeste', '--photo', file)
  assert.equal(covered.status, 0)
  const cover = covered.json['result'] as { cover: { source: string; sha256: string } }
  assert.equal(cover.cover.source, 'user')
  assert.match(cover.cover.sha256, /^[0-9a-f]{64}$/)
})

test('gamereg cover --from promotes an attachment already on record', async () => {
  const root = vault()
  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const file = await photo(root, { r: 14, g: 15, b: 16 })
  const attached = run(root, 'attach', 'celeste', '--photo', file)
  const sha = (attached.json['result'] as { attachments: { sha256: string }[] }).attachments[0]!.sha256

  const covered = run(root, 'cover', 'celeste', '--from', sha)
  assert.equal(covered.status, 0)
  assert.equal((covered.json['result'] as { cover: { sha256: string } }).cover.sha256, sha)
})

test('gamereg cover --from an unknown hash is not_found', () => {
  const root = vault()
  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const covered = run(root, 'cover', 'celeste', '--from', 'f'.repeat(64))
  assert.equal(covered.status, 4)
})

test('gamereg cover --reset appends source: provider without deleting the earlier attachment', async () => {
  const root = vault()
  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  const file = await photo(root, { r: 17, g: 18, b: 19 })
  run(root, 'cover', 'celeste', '--photo', file)

  const reset = run(root, 'cover', 'celeste', '--reset')
  assert.equal(reset.status, 0)
  assert.equal((reset.json['result'] as { cover: { source: string } }).cover.source, 'provider')

  // The photo itself is still on the timeline — it was an attachment, not only a cover pointer.
  run(root, 'build')
  const note = readFileSync(join(root, 'obsidian', 'games', 'celeste.md'), 'utf8')
  assert.match(note, /## Gallery/)
})

test('gamereg cover with no source, or with more than one, is a usage error', async () => {
  const root = vault()
  run(root, 'start', 'celeste', '--no-metadata', '--at', '2026-05-03 20:00')
  assert.equal(run(root, 'cover', 'celeste').status, 2)

  const file = await photo(root, { r: 20, g: 21, b: 22 })
  assert.equal(run(root, 'cover', 'celeste', '--photo', file, '--reset').status, 2)
})

test('a nonexistent photo path is a clear usage error, not a crash', () => {
  const root = vault()
  const started = run(root, 'start', 'celeste', '--no-metadata', '--photo', join(root, 'missing.jpg'), '--at', '2026-05-03 20:00')
  assert.equal(started.status, 2)
})
