/**
 * The build lock (docs/spec/02-cli.md, `gamereg build`; src/targets/lock.ts).
 *
 * `data/log.db` has no atomic rename-into-place — two `build` processes
 * writing the same vault at once can tear it, not just leave it stale. The
 * lock exists to make that impossible, and to recover on its own from a lock
 * left behind by a process that no longer exists.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { GameregError } from '../src/core/errors.ts'
import { openVault } from '../src/core/vault.ts'
import { appendEvents, readEvents } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { build } from '../src/targets/build.ts'
import { acquireBuildLock } from '../src/targets/lock.ts'
import { event, tempDir } from './helpers.ts'

function vault(): string {
  const root = join(tempDir('gamereg-build-lock-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({
      locale: 'en',
      timezone: 'America/Sao_Paulo',
      build: { targets: ['csv'] },
    }),
  )
  return root
}

/** A pid no live process can plausibly hold, so isAlive() reads it as gone. */
const DEAD_PID = 999999999

test('acquiring the lock writes the holder pid, and releasing removes the file', () => {
  const root = vault()
  const opened = openVault(root)

  const release = acquireBuildLock(opened)
  assert.equal(existsSync(opened.lockFile), true)
  assert.equal(readFileSync(opened.lockFile, 'utf8').trim(), String(process.pid))

  release()
  assert.equal(existsSync(opened.lockFile), false)
})

test('a second acquire against a live holder is refused, not queued', () => {
  const root = vault()
  const opened = openVault(root)

  const release = acquireBuildLock(opened)
  try {
    assert.throws(
      () => acquireBuildLock(opened),
      (error: unknown) =>
        error instanceof GameregError && error.error === 'conflict' && error.key === 'error.build_in_progress',
    )
  } finally {
    release()
  }
})

test('releasing twice is harmless', () => {
  const root = vault()
  const opened = openVault(root)
  const release = acquireBuildLock(opened)
  release()
  assert.doesNotThrow(() => release())
})

test('a lock left by a process that no longer exists is stale, and is cleared automatically', () => {
  const root = vault()
  const opened = openVault(root)
  mkdirSync(join(root, '.gamereg'), { recursive: true })
  writeFileSync(opened.lockFile, String(DEAD_PID))

  const release = acquireBuildLock(opened)
  assert.equal(readFileSync(opened.lockFile, 'utf8').trim(), String(process.pid))
  release()
})

test('a lock file with unreadable content is treated as stale, not as a live holder', () => {
  const root = vault()
  const opened = openVault(root)
  mkdirSync(join(root, '.gamereg'), { recursive: true })
  writeFileSync(opened.lockFile, 'not-a-pid')

  const release = acquireBuildLock(opened)
  release()
})

test('gamereg build refuses to run while a live process holds the lock', () => {
  const root = vault()
  const opened = openVault(root)
  appendEvents(opened.eventsFile, [event('game.create', { game_id: '01K5A00000000000000000GAMA', slug: 'hollow-knight', title: 'Hollow Knight', genres: [], platforms: [], providers: {}, aliases: [] })])

  mkdirSync(join(root, '.gamereg'), { recursive: true })
  writeFileSync(opened.lockFile, String(process.pid))

  const state = fold(readEvents(opened.eventsFile), timeContext(opened))
  assert.throws(
    () => build(opened, state, translator('en')),
    (error: unknown) =>
      error instanceof GameregError && error.error === 'conflict' && error.key === 'error.build_in_progress',
  )

  // Refused before anything is written: the target this vault declares never
  // lands, and the lock file is exactly what was planted, untouched.
  assert.equal(existsSync(join(root, 'csv', 'games.csv')), false)
  assert.equal(readFileSync(opened.lockFile, 'utf8').trim(), String(process.pid))
})

test('a normal build releases the lock, and a second build right after succeeds', () => {
  const root = vault()
  const opened = openVault(root)
  appendEvents(opened.eventsFile, [event('game.create', { game_id: '01K5A00000000000000000GAMA', slug: 'hollow-knight', title: 'Hollow Knight', genres: [], platforms: [], providers: {}, aliases: [] })])
  const state = fold(readEvents(opened.eventsFile), timeContext(opened))

  build(opened, state, translator('en'))
  assert.equal(existsSync(opened.lockFile), false)

  // Would throw on a lock leaked by the first build.
  const second = build(opened, state, translator('en'))
  assert.equal(second.failed.length, 0)
  assert.equal(existsSync(opened.lockFile), false)
})

test('--dry-run never touches the lock at all', () => {
  const root = vault()
  const opened = openVault(root)
  appendEvents(opened.eventsFile, [event('game.create', { game_id: '01K5A00000000000000000GAMA', slug: 'hollow-knight', title: 'Hollow Knight', genres: [], platforms: [], providers: {}, aliases: [] })])
  const state = fold(readEvents(opened.eventsFile), timeContext(opened))

  build(opened, state, translator('en'), { dryRun: true })
  assert.equal(existsSync(opened.lockFile), false)
})
