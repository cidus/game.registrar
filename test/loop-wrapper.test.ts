/**
 * `docker/loop.sh`, the maintenance interval, driven for a few ticks.
 *
 * On a host this job belongs to `scripts/gamereg-autobuild.timer`, and systemd
 * supplies two guarantees a shell loop does not inherit: no overlapping run of
 * a `Type=oneshot` unit, and a stagger. The loop deliberately reproduces
 * neither, so what is worth testing is the property that makes that safe —
 * a tick's failure must never end the loop. A container whose maintenance
 * service exits on the first transient network error is a container that
 * stops committing the vault and says nothing about it.
 *
 * `autobuild.sh` is stubbed here rather than real: `test/autobuild-wrapper.test.ts`
 * already drives the real one against a real vault, and what this file is
 * asking about is the loop around it.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const WRAPPER = join(import.meta.dirname, '..', 'docker', 'loop.sh')

/**
 * Runs the loop for `ms` with a one-second interval and a stub that exits
 * `code`, then reports how many ticks happened. The loop never returns on its
 * own, so the timeout is the terminator — the same SIGTERM `docker compose
 * stop` sends.
 */
function ticks(options: { code: number; ms: number }): { count: number; stderr: string } {
  const dir = tempDir('gamereg-loop-')
  const log = join(dir, 'ticks.log')
  const autobuild = join(dir, 'autobuild')

  writeFileSync(autobuild, `#!/bin/sh\necho tick >> ${JSON.stringify(log)}\nexit ${options.code}\n`)
  chmodSync(autobuild, 0o755)

  const result = spawnSync('sh', [WRAPPER], {
    encoding: 'utf8',
    timeout: options.ms,
    env: {
      PATH: process.env['PATH'] ?? '',
      GAMEREG_AUTOBUILD_BIN: autobuild,
      GAMEREG_AUTOBUILD_INTERVAL: '1',
    },
  })

  const count = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0
  return { count, stderr: result.stderr ?? '' }
}

test('it runs the sweep repeatedly rather than once', () => {
  const { count } = ticks({ code: 0, ms: 2600 })
  assert.ok(count >= 2, `expected at least two ticks in 2.6s at a 1s interval, saw ${count}`)
})

test('a failed tick does not end the loop', () => {
  // Every non-zero exit autobuild.sh produces is transient by nature: a
  // provider that was unreachable, a remote that rejected a push, another
  // build holding the lock. Exiting would hand the retry to the restart
  // policy, on its schedule instead of this one, and lose the reason.
  const { count, stderr } = ticks({ code: 1, ms: 2600 })
  assert.ok(count >= 2, `the loop stopped after a failure, saw ${count} ticks`)
  assert.match(stderr, /continuing/)
})

test('it announces its interval, so a container log says what it is doing', () => {
  const { stderr } = ticks({ code: 0, ms: 1200 })
  assert.match(stderr, /every 1s/)
})
