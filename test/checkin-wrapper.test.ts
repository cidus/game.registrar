/**
 * `agent/checkin.sh`, the hourly poll, driven end to end.
 *
 * The wrapper is the gateway's half of the check-in machinery and the only
 * part of this feature that no other test can reach: `test/checkin.test.ts`
 * covers what the CLI does when it is called, and this covers *whether it is
 * called, with what, and in which order*. Only `openclaw` is stubbed — the
 * `gamereg` the wrapper runs is this repository's own CLI, against a real
 * vault, so a renamed flag fails here rather than at 04:00 on a live host.
 *
 * The order is the point. The wake goes out first and the check-ins are filed
 * second, so that forgetting to record one makes the Registrar repeat itself
 * rather than fall silent (docs/spec/02-cli.md, `gamereg checkin`).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const ROOT = join(import.meta.dirname, '..')
const WRAPPER = join(ROOT, 'agent', 'checkin.sh')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')

type Host = {
  vault: string
  /** Every stubbed `openclaw` invocation, one line of argv per call. */
  calls: () => string[]
  /** What the last wake actually said, or `null` if none was sent. */
  wake: () => string | null
  run: (...args: string[]) => { status: number; stdout: string; stderr: string }
}

/**
 * The instant every one of these tests is evaluated at, and the instant the
 * session is measured from. Both fixed: the wrapper forwards `--at` to every
 * `gamereg` call it makes, so nothing here reads a clock. An earlier version of
 * this file built its fixture from `Date.now()` and asserted the trigger was
 * `duration` — which was true when run at night and false by mid-morning, the
 * five-hour session having crossed `day_cutoff` by then. It passed for a day
 * and then failed on the hour of day, which is the one thing `--at` exists to
 * make impossible.
 */
const NOW = '2026-05-03 22:00'
const OPENED = '2026-05-03 17:00'

/**
 * A vault with one session open long enough to be due, and a stub `openclaw`
 * that records what it was asked to do.
 */
function host(options: { openclawExit?: number; opened?: string; to?: string; locale?: string } = {}): Host {
  const dir = tempDir('gamereg-wrapper-')
  const vault = join(dir, 'vault')
  const bin = join(dir, 'bin')
  const log = join(dir, 'calls.log')
  mkdirSync(vault, { recursive: true })
  mkdirSync(bin, { recursive: true })

  // 05:00 on the day the session opened is before it opened, so `day_cutoff`
  // never fires and `duration` is the only trigger reachable — deliberately,
  // since which trigger wins is `test/due.test.ts`'s subject and not this
  // file's. `clock` and `quiet_hours` are off for the same reason.
  writeFileSync(
    join(vault, 'gamereg.config.json'),
    JSON.stringify({
      locale: options.locale ?? 'en',
      timezone: 'America/Sao_Paulo',
      day_cutoff: '05:00',
      checkin: { after: '4h', clock: [], quiet_hours: [], chase_at: null },
    }),
  )

  const shim = join(bin, 'gamereg')
  writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(shim, 0o755)

  const stub = join(bin, 'openclaw')
  writeFileSync(
    stub,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      // Keep whatever the wake said; the temp file it lives in is gone by the
      // time this test gets to look.
      `for a in "$@"; do if [ "$prev" = "--message-file" ]; then cp "$a" ${JSON.stringify(join(dir, 'wake.txt'))}; fi; prev=$a; done`,
      `exit ${options.openclawExit ?? 0}`,
    ].join('\n') + '\n',
  )
  chmodSync(stub, 0o755)

  const started = spawnSync(
    process.execPath,
    [MAIN, '--vault', vault, '--json', 'start', 'hollow knight', '--no-metadata', '--at', options.opened ?? OPENED],
    { encoding: 'utf8', env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1' } },
  )
  assert.equal(started.status, 0, started.stderr)

  return {
    vault,
    calls: () => {
      try {
        return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
    wake: () => {
      try {
        return readFileSync(join(dir, 'wake.txt'), 'utf8')
      } catch {
        return null
      }
    },
    run: (...args: string[]) => {
      const result = spawnSync('sh', [WRAPPER, '--at', NOW, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GAMEREG_VAULT: vault,
          GAMEREG_BIN: shim,
          OPENCLAW_BIN: stub,
          GAMEREG_SOURCE: 'chat',
          GAMEREG_CHECKIN_CHANNEL: options.to === undefined ? '' : 'telegram',
          GAMEREG_CHECKIN_TO: options.to ?? '',
          NO_COLOR: '1',
        },
      })
      return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
  }
}

/** The `session.checkin` events the wrapper actually filed. */
function checkins(vault: string): Record<string, unknown>[] {
  const lines = readFileSync(join(vault, 'data', 'events.jsonl'), 'utf8').trim().split('\n')
  return lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event['type'] === 'session.checkin')
}

test('a poll with nothing to say says nothing at all, and files nothing', () => {
  // Two hours in is under the four-hour threshold: not due, and the whole
  // feature rests on this costing nobody a message.
  const gateway = host({ opened: '2026-05-03 20:00' })
  const run = gateway.run()

  assert.equal(run.status, 0)
  assert.equal(run.stdout, '')
  assert.deepEqual(gateway.calls(), [])
  assert.deepEqual(checkins(gateway.vault), [])
})

test('a poll with something to say wakes the agent once, then files the snooze', () => {
  const gateway = host()
  const run = gateway.run()
  assert.equal(run.status, 0, run.stderr)

  // One wake, however many sessions — one message listing them is the rule,
  // and a wrapper that woke the agent per row would break it before the agent
  // ever got a chance to.
  const calls = gateway.calls()
  assert.equal(calls.length, 1)
  assert.match(calls[0] ?? '', /^agent --agent main --message-file \S+ --json --deliver$/)

  const filed = checkins(gateway.vault)
  assert.equal(filed.length, 1)
  assert.equal((filed[0]?.['data'] as Record<string, unknown>)['outcome'], 'snoozed')
  assert.equal((filed[0]?.['data'] as Record<string, unknown>)['trigger'], 'duration')

  // Filed by the poll, not by a conversation — and `chat` was in the
  // environment it inherited, which is exactly the value it has to overwrite.
  assert.equal(filed[0]?.['source'], 'cron')
})

test('stdout stays empty even when there is something to say', () => {
  // A cron command job delivers its output to a chat unless registered with
  // --no-deliver. Anything printed here is one misregistered job away from
  // being sent to the user as raw JSON.
  const gateway = host()
  assert.equal(gateway.run().stdout, '')
})

test('the wake carries the facts and forbids the two commands that are not the agent to run', () => {
  const gateway = host()
  gateway.run()
  const wake = gateway.wake() ?? ''

  assert.match(wake, /Do not run `gamereg due` or `gamereg checkin`/)
  assert.match(wake, /Send one message covering all of them/)

  // The rows are the CLI's own output, appended verbatim, so this file and
  // `gamereg due` cannot drift into two descriptions of one payload.
  const rows = JSON.parse(wake.slice(wake.indexOf('['))) as Record<string, unknown>[]
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.['game'], 'hollow knight')
  assert.equal(rows[0]?.['trigger'], 'duration')
  assert.equal(typeof rows[0]?.['open_for_minutes'], 'number')
})

test('a wake that never lands files nothing, so the session is asked again next tick', () => {
  const gateway = host({ openclawExit: 7 })
  const run = gateway.run()

  assert.equal(run.status, 1)
  assert.match(run.stderr, /the wake failed/)
  assert.deepEqual(checkins(gateway.vault), [])

  // Nothing was recorded, so the next poll finds the session due all over
  // again. Repeating is the direction this feature is allowed to fail in.
  const second = host()
  assert.equal(second.run().status, 0)
})

test('--dry-run shows the whole cycle and performs none of it', () => {
  const gateway = host()
  const run = gateway.run('--dry-run')

  assert.equal(run.status, 0)
  assert.equal(run.stdout, '')
  assert.match(run.stderr, /would wake the agent/)
  assert.match(run.stderr, /gamereg checkin \S+ --trigger duration --outcome snoozed/)
  assert.deepEqual(gateway.calls(), [])
  assert.deepEqual(checkins(gateway.vault), [])
})

test('a vault it was never told about is a misconfiguration, not a guess', () => {
  const result = spawnSync('sh', [WRAPPER], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_VAULT: '' },
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr ?? '', /GAMEREG_VAULT is not set/)
})

test('a delivery target reaches the wake as routing, never as a chat id in the prose', () => {
  // A turn started by a poll carries no inbound message, so nothing tells the
  // agent which conversation it is in. Without a target the question still
  // arrives — it is the agent's own reply, and the runner routes that — but the
  // message tool cannot be used, which is where buttons live.
  const routed = host({ to: '8119169239' })
  routed.run()
  assert.match(
    routed.calls()[0] ?? '',
    /^agent --agent main --message-file \S+ --json --reply-channel telegram --reply-to 8119169239$/,
  )

  // The id is routing, not something the model should ever read and repeat.
  const wake = routed.wake() ?? ''
  assert.doesNotMatch(wake, /8119169239/)
  assert.match(wake, /do not set\n`target`/)

  const plain = host()
  plain.run()
  assert.match(plain.wake() ?? '', /Ask in plain text, with no buttons/)
})

test('the wake names the language to ask in, since a poll gives nothing to infer it from', () => {
  // Left to work it out, the agent reaches for session history and memory and
  // then guesses. The register's configured locale is the one answer the vault
  // actually holds, and it is a tag, never a phrasing.
  const gateway = host({ locale: 'pt-BR' })
  gateway.run()
  const wake = gateway.wake() ?? ''

  assert.match(wake, /configured for pt-BR/)
  assert.match(wake, /Do not search session history/)

  const other = host({ locale: 'en' })
  other.run()
  assert.match(other.wake() ?? '', /configured for en/)
})

test('exactly one delivery path, because two of them is how a check-in arrives twice', () => {
  // A model narrating alongside a tool call is ordinary behaviour, and the
  // narration is usually the sentence it just sent. With `--deliver` on *and*
  // the message tool routed, both go out: the same check-in arrives twice, once
  // with buttons and once without. Both of the first two real ones did.
  //
  // So the two modes are exclusive, and this is the assertion that keeps them
  // that way — the bug is invisible from inside a single run.
  const routed = host({ to: '8119169239' })
  routed.run()
  assert.doesNotMatch(routed.calls()[0] ?? '', /--deliver/)
  assert.match(routed.wake() ?? '', /your own reply text is not\ndelivered/)

  // With no target the message tool cannot reach the conversation, so the
  // agent's reply is the only thing that can carry the question.
  const plain = host()
  plain.run()
  assert.match(plain.calls()[0] ?? '', /--deliver/)
  assert.doesNotMatch(plain.wake() ?? '', /message tool and \*\*do not set/)
})

test('--at is forwarded to every gamereg call, which is what makes this file honest', () => {
  // The wrapper has no clock of its own once this is passed, so a fixture built
  // around a fixed instant behaves identically at any hour. Proven by asking
  // for an instant at which the session is not yet due, against a vault whose
  // session would be long overdue by now.
  const gateway = host({ opened: '2026-05-03 17:00' })
  const early = gateway.run('--at', '2026-05-03 19:00')

  assert.equal(early.status, 0)
  assert.deepEqual(gateway.calls(), [])
  assert.deepEqual(checkins(gateway.vault), [])
})
