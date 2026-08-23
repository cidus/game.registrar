/**
 * `gamereg due` and `gamereg checkin`, through the real binary.
 *
 * `test/due.test.ts` covers the trigger matrix; this file covers the contract
 * around it — exit codes, what each command is allowed to write, and the one
 * cycle the cron wrapper actually runs: ask what is due, file the question,
 * expire it when nobody answers.
 *
 * Every invocation passes `--at`, which is the whole reason this is testable:
 * the evaluator has no clock of its own.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

type Run = { status: number; json: Record<string, unknown> }

function vault(config: Record<string, unknown> = {}): string {
  const root = join(tempDir('gamereg-checkin-'), 'vault')
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
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse((result.stdout ?? '').trim()) as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: result.status ?? 1, json }
}

const result = (run: Run): Record<string, unknown> => run.json['result'] as Record<string, unknown>
const rows = (run: Run): Record<string, unknown>[] => result(run)['due'] as Record<string, unknown>[]

function logLines(root: string): string[] {
  return readFileSync(join(root, 'data', 'events.jsonl'), 'utf8').trim().split('\n')
}

/** One open session on Hollow Knight, filed at 20:00. Returns its id. */
function openSession(root: string): string {
  const started = gamereg(root, 'start', 'hollow knight', '--no-metadata', '--at', '2026-05-03 20:00')
  assert.equal(started.status, 0)
  return result(started)['session_id'] as string
}

test('the cron cycle: ask, file, back off, expire, chase', () => {
  const root = vault()
  const session = openSession(root)

  // Nothing to say, which is the common answer and the important one.
  const quiet = gamereg(root, 'due', '--at', '2026-05-03 23:00')
  assert.equal(quiet.status, 0)
  assert.deepEqual(rows(quiet), [])

  const first = gamereg(root, 'due', '--at', '2026-05-04 00:30')
  assert.equal(first.status, 0)
  assert.equal(rows(first).length, 1)
  assert.equal(rows(first)[0]?.['session_id'], session)
  assert.equal(rows(first)[0]?.['trigger'], 'duration')
  assert.equal(rows(first)[0]?.['threshold'], '4h')
  assert.equal(rows(first)[0]?.['open_for_minutes'], 270)

  const filed = gamereg(root, 'checkin', session, '--trigger', 'duration', '--at', '2026-05-04 00:31')
  assert.equal(filed.status, 0)
  assert.equal(filed.json['action'], 'session.checkin')
  assert.equal(result(filed)['outcome'], 'snoozed')

  // Inside the first rung of the ladder, so the session is not raised again.
  assert.deepEqual(rows(gamereg(root, 'due', '--at', '2026-05-04 01:30')), [])

  // Nobody answered. Silence is an answer, and this is what records it as one.
  const expired = gamereg(root, 'checkin', '--expire', '--at', '2026-05-04 01:30')
  assert.equal(expired.status, 0)
  assert.equal(expired.json['action'], 'checkin.expire')
  const swept = result(expired)['expired'] as Record<string, unknown>[]
  assert.equal(swept.length, 1)
  assert.equal(swept[0]?.['event_id'], result(filed)['checkin_id'])

  const amend = JSON.parse(logLines(root).at(-1) ?? '{}') as Record<string, unknown>
  assert.equal(amend['type'], 'event.amend')
  assert.deepEqual((amend['data'] as Record<string, unknown>)['patch'], { outcome: 'no_reply' })

  // A second sweep has nothing to find: the record it amended is no longer
  // snoozed. Without that, an hourly cron would amend the same event forever.
  const again = gamereg(root, 'checkin', '--expire', '--at', '2026-05-04 02:30')
  assert.deepEqual(result(again)['expired'], [])
  assert.deepEqual(again.json['events'], [])

  // The morning chase, which is exempt from everything the ladder just did.
  const chase = gamereg(root, 'due', '--at', '2026-05-04 09:00')
  assert.equal(rows(chase)[0]?.['trigger'], 'day_cutoff')
  assert.equal(rows(chase)[0]?.['checkins_so_far'], 1)
  assert.equal(rows(chase)[0]?.['last_checkin_at'], '2026-05-04T00:31:00-03:00')
})

test('due reads and never writes', () => {
  const root = vault()
  openSession(root)
  const before = logLines(root).length

  const run = gamereg(root, 'due', '--at', '2026-05-04 09:00')
  assert.equal(rows(run).length, 1)
  assert.deepEqual(run.json['events'], [])
  assert.equal(logLines(root).length, before)
})

test('a check-in never mutates the session it asks about', () => {
  const root = vault()
  const session = openSession(root)
  gamereg(root, 'checkin', session, '--trigger', 'duration', '--at', '2026-05-04 00:31')

  const open = result(gamereg(root, 'open', '--at', '2026-05-04 01:00'))['open'] as Record<string, unknown>[]
  assert.equal(open.length, 1)
  assert.equal(open[0]?.['session_id'], session)
  assert.equal(open[0]?.['checkins_so_far'], 1)
  assert.equal(open[0]?.['open_for_minutes'], 300)

  // One event, and it is the check-in. Nothing closed, nothing paused.
  const last = JSON.parse(logLines(root).at(-1) ?? '{}') as Record<string, unknown>
  assert.equal(last['type'], 'session.checkin')
})

test('the outcome an answer produces is an amend over the same event', () => {
  const root = vault()
  const session = openSession(root)
  const filed = gamereg(root, 'checkin', session, '--trigger', 'duration', '--at', '2026-05-04 00:31')
  const checkin = result(filed)['checkin_id'] as string

  const amended = gamereg(root, 'amend', checkin, '--reason', 'user took a break', '--set', 'outcome=break_started')
  assert.equal(amended.status, 0)

  // Answered, so the sweep must leave it alone however long ago it was asked.
  assert.deepEqual(result(gamereg(root, 'checkin', '--expire', '--at', '2026-05-05 09:00'))['expired'], [])
})

test('checkin refuses what it cannot record, by exit code', () => {
  const root = vault()
  const session = openSession(root)

  // No session named, and no --expire either.
  assert.equal(gamereg(root, 'checkin', '--trigger', 'duration').status, 2)
  assert.equal(gamereg(root, 'checkin', session).status, 2)
  assert.equal(gamereg(root, 'checkin', session, '--trigger', 'because').status, 2)
  assert.equal(gamereg(root, 'checkin', session, '--trigger', 'duration', '--outcome', 'maybe').status, 2)
  // --expire asks the log what is stale; a session argument is a different command.
  assert.equal(gamereg(root, 'checkin', session, '--trigger', 'duration', '--expire').status, 2)

  const unknown = gamereg(root, 'checkin', '01K000000000000000000000', '--trigger', 'duration')
  assert.equal(unknown.status, 4)
  assert.equal(unknown.json['error'], 'not_found')
})

test('a vault that switches the noticing triggers off still gets its data chased', () => {
  const root = vault({ checkin: { after: null, clock: [] } })
  openSession(root)

  assert.deepEqual(rows(gamereg(root, 'due', '--at', '2026-05-04 00:30')), [])
  assert.equal(rows(gamereg(root, 'due', '--at', '2026-05-04 09:00'))[0]?.['trigger'], 'day_cutoff')
})

test('the cron source is recorded on the event, since that is who files it', () => {
  const root = vault()
  const session = openSession(root)

  const result = spawnSync(
    process.execPath,
    [MAIN, '--vault', root, '--json', 'checkin', session, '--trigger', 'day_cutoff', '--at', '2026-05-04 09:00'],
    { encoding: 'utf8', env: { ...process.env, GAMEREG_SOURCE: 'cron', GAMEREG_NON_INTERACTIVE: '1' } },
  )
  assert.equal(result.status, 0)

  const last = JSON.parse(logLines(root).at(-1) ?? '{}') as Record<string, unknown>
  assert.equal(last['source'], 'cron')
  assert.equal(last['type'], 'session.checkin')
})

test('the check-in an answer settles is reachable from open, which is the agent only route to it', () => {
  const root = vault()
  const session = openSession(root)
  const open = (at: string): Record<string, unknown> | undefined =>
    (result(gamereg(root, 'open', '--at', at))['open'] as Record<string, unknown>[])[0]

  // Never asked about: there is nothing to settle, and the field says so.
  assert.equal(open('2026-05-04 00:30')?.['last_checkin_id'], null)

  const filed = gamereg(root, 'checkin', session, '--trigger', 'duration', '--at', '2026-05-04 00:31')
  const checkin = result(filed)['checkin_id'] as string
  assert.equal(open('2026-05-04 00:32')?.['last_checkin_id'], checkin)

  // The wake is enqueued before the record exists, so `due` can only ever name
  // the previous question. Asking a second time is what proves the difference:
  // the row returned the next morning still names the check-in filed at 00:31,
  // whatever trigger it is standing on by then.
  const second = rows(gamereg(root, 'due', '--at', '2026-05-04 09:00'))[0]
  assert.equal(second?.['last_checkin_id'], checkin)
  assert.equal(second?.['last_checkin_at'], '2026-05-04T00:31:00-03:00')

  // And it is readable only while the session is open, which is why the agent
  // reads it before closing rather than after.
  assert.equal(gamereg(root, 'end', '--at', '2026-05-04 00:40').status, 0)
  assert.equal(open('2026-05-04 00:41'), undefined)

  // The id survives the close, though — the amend targets an event, not a session.
  assert.equal(
    gamereg(root, 'amend', checkin, '--reason', 'answered', '--set', 'outcome=session_closed').status,
    0,
  )
})
