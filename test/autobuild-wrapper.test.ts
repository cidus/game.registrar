/**
 * `scripts/autobuild.sh`, the periodic vault maintenance sweep, driven end to
 * end.
 *
 * Sibling of `test/checkin-wrapper.test.ts`, with the roles of "real" and
 * "stub" swapped: there `gamereg` was this repository's own CLI and
 * `openclaw` was faked, because a real Telegram send is not something a test
 * should risk. Here `gamereg` is again the real CLI, run against a real
 * vault — but `git` is the one stubbed, so a test can log every invocation,
 * force one to fail on demand, and never actually push anywhere. Everything
 * `git` itself does (`status`, `add`, `diff`, `commit`) still runs for real
 * against a real repository the stub execs into; only the failure-injection
 * knob is fake.
 *
 * No IGDB credentials are configured for these tests (`npm test` runs with no
 * network, by repository convention — see CLAUDE.md's *Testing strategy*), so
 * every `gamereg enrich --missing` call here exits 6 (`provider_unavailable`)
 * for real. That is not worked around: exit 6 being non-fatal is exactly the
 * behaviour these tests are meant to prove.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const ROOT = join(import.meta.dirname, '..')
const WRAPPER = join(ROOT, 'scripts', 'autobuild.sh')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')

const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

type Host = {
  vault: string
  /** Every stubbed `git` invocation, one line of argv per call. */
  calls: () => string[]
  /** How many commits exist on the vault's default branch right now. */
  commitCount: () => number
  run: (...args: string[]) => { status: number; stdout: string; stderr: string }
  /** Creates a game directly against the vault, dirtying the tree, the way `start` would. */
  createGame: (title: string) => void
}

/**
 * A vault that is a real git repository (one initial commit, so `git status`
 * starts clean), plus a `git` stub that logs argv and execs the real binary —
 * except for one subcommand a test may ask it to fail instead, which is what
 * makes `git commit failed` and similar paths reachable without corrupting a
 * real repository to force them.
 */
function host(options: { failCmd?: string; failCode?: number } = {}): Host {
  const dir = tempDir('gamereg-autobuild-')
  const vault = join(dir, 'vault')
  const bin = join(dir, 'bin')
  const log = join(dir, 'calls.log')
  mkdirSync(vault, { recursive: true })
  mkdirSync(bin, { recursive: true })

  const gamereg = join(bin, 'gamereg')
  writeFileSync(gamereg, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(gamereg, 0o755)

  const git = join(bin, 'git')
  writeFileSync(
    git,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      options.failCmd !== undefined
        ? `[ "$1" = ${JSON.stringify(options.failCmd)} ] && exit ${options.failCode ?? 1}`
        : '',
      `exec ${JSON.stringify(REAL_GIT)} "$@"`,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  )
  chmodSync(git, 0o755)

  execFileSync(REAL_GIT, ['init', '-q'], { cwd: vault })
  execFileSync(
    REAL_GIT,
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '--allow-empty', '-m', 'init'],
    { cwd: vault },
  )

  return {
    vault,
    calls: () => {
      try {
        return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
    commitCount: () =>
      Number.parseInt(execFileSync(REAL_GIT, ['rev-list', '--count', 'HEAD'], { cwd: vault, encoding: 'utf8' }), 10),
    createGame: (title: string) => {
      const result = spawnSync(
        process.execPath,
        [MAIN, '--vault', vault, '--json', 'start', title, '--no-metadata'],
        { encoding: 'utf8', env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1' } },
      )
      assert.equal(result.status, 0, result.stderr)
    },
    run: (...args: string[]) => {
      const result = spawnSync('sh', [WRAPPER, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GAMEREG_VAULT: vault,
          GAMEREG_BIN: gamereg,
          GIT_BIN: git,
          GAMEREG_SOURCE: 'chat',
          NO_COLOR: '1',
        },
      })
      return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
  }
}

test('a clean vault does nothing beyond noticing it is clean', () => {
  const gateway = host()
  const before = gateway.commitCount()
  const run = gateway.run()

  assert.equal(run.status, 0)
  assert.equal(run.stdout, '')
  assert.equal(gateway.commitCount(), before)

  // The only git call a clean tick makes is the status check that tells it
  // there is nothing to do — no add, no commit, no push.
  assert.deepEqual(gateway.calls(), ["status --porcelain -- . :!.gamereg"])
})

test('--dry-run describes the cycle on stderr and touches nothing', () => {
  const gateway = host()
  gateway.createGame('hollow knight')
  const before = gateway.commitCount()
  const run = gateway.run('--dry-run')

  assert.equal(run.status, 0)
  assert.equal(run.stdout, '')
  assert.match(run.stderr, /would run, in the vault at/)
  assert.match(run.stderr, /enrich --missing --covers --json/)
  assert.match(run.stderr, /build --json/)
  assert.deepEqual(gateway.calls(), [])
  assert.equal(gateway.commitCount(), before)
})

test('GAMEREG_VAULT unset is a misconfiguration, not a guess', () => {
  const result = spawnSync('sh', [WRAPPER], { encoding: 'utf8', env: { ...process.env, GAMEREG_VAULT: '' } })
  assert.equal(result.status, 2)
  assert.match(result.stderr ?? '', /GAMEREG_VAULT/)
})

test('a new game with no IGDB credentials still gets committed: exit 6 is not a failure', () => {
  const gateway = host()
  gateway.createGame('hollow knight')
  const before = gateway.commitCount()

  const run = gateway.run()

  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, '')
  // provider_unavailable is expected here (no credentials in the test
  // environment) and must not be reported as a failure.
  assert.doesNotMatch(run.stderr, /failed/)
  assert.equal(gateway.commitCount(), before + 1)

  const message = execFileSync(REAL_GIT, ['log', '-1', '--format=%s'], { cwd: gateway.vault, encoding: 'utf8' })
  assert.match(message, /chore\(vault\)/)

  // The tree is clean again, so a second tick short-circuits before it ever
  // calls `gamereg enrich --missing` a second time — the git-state design
  // means there is nothing left to select, without `--missing` itself having
  // to know that.
  const callsBeforeSecond = gateway.calls().length
  const second = gateway.run()
  assert.equal(second.status, 0)
  // Exactly one more git call: the status check that finds the tree clean
  // and stops there.
  assert.equal(gateway.calls().length, callsBeforeSecond + 1)
  assert.equal(gateway.commitCount(), before + 1)
})

test('a build lock held by a live process leaves the tick uncommitted', () => {
  const gateway = host()
  gateway.createGame('celeste')
  const before = gateway.commitCount()

  mkdirSync(join(gateway.vault, '.gamereg'), { recursive: true })
  // This test process is alive for the whole run, so the lock reads as held.
  writeFileSync(join(gateway.vault, '.gamereg', 'build.lock'), String(process.pid))

  const run = gateway.run()

  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, '')
  assert.equal(gateway.commitCount(), before)
  assert.equal(gateway.calls().filter((call) => call.startsWith('commit')).length, 0)
})

test('stdout stays empty end to end, even on a full enrich-build-commit cycle', () => {
  const gateway = host()
  gateway.createGame('hollow knight')
  assert.equal(gateway.run().stdout, '')
})

test('a git commit failure is reported on stderr and the tick exits non-zero', () => {
  const gateway = host({ failCmd: 'commit', failCode: 1 })
  gateway.createGame('hollow knight')

  const run = gateway.run()

  assert.equal(run.status, 1)
  assert.match(run.stderr, /git commit failed/)
})

test('a push is attempted only once a remote exists, and never before', () => {
  const gateway = host()
  gateway.createGame('hollow knight')
  const run = gateway.run()

  assert.equal(run.status, 0, run.stderr)
  assert.equal(
    gateway.calls().some((call) => call.startsWith('push')),
    false,
  )

  execFileSync(REAL_GIT, ['init', '--bare', '-q', join(gateway.vault, '..', 'remote.git')])
  execFileSync(REAL_GIT, ['remote', 'add', 'origin', join(gateway.vault, '..', 'remote.git')], { cwd: gateway.vault })

  gateway.createGame('celeste')
  const withRemote = gateway.run()

  assert.equal(withRemote.status, 0, withRemote.stderr)
  assert.equal(
    gateway.calls().some((call) => call.startsWith('push')),
    true,
  )
  assert.ok(existsSync(join(gateway.vault, '..', 'remote.git')))
})
