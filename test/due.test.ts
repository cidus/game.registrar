/**
 * The check-in trigger evaluator (docs/spec/05-agent.md "Check-ins").
 *
 * The production failure mode here is not a wrong number, it is an assistant
 * that nags — which nobody reports, they just mute it, and the `day_cutoff`
 * chase loses its credibility along with the two triggers that were merely
 * being friendly. So the table below spends most of its rows on the cases
 * where nothing may be returned: quiet hours, backoff, the ceiling. Each
 * trigger gets one row that fires, and each of the three brakes gets a row
 * proving it holds, plus the rows proving `day_cutoff` is exempt from two of
 * them.
 *
 * Pure over folded state and an instant, so `at` is the entire harness — no
 * clock, no filesystem, no network.
 */
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { test } from 'node:test'

import { DEFAULT_CONFIG, type CheckinConfig, type Config } from '../src/core/config.ts'
import { due, staleCheckins } from '../src/core/due.ts'
import type { EventEnvelope } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import type { CheckinOutcome, CheckinTrigger } from '../src/core/vocab.ts'
import { context, event, ZONE } from './helpers.ts'

/** `2026-05-03 20:00` in the fixture zone, written the way a test reads best. */
function at(value: string): DateTime {
  const parsed = DateTime.fromISO(value.replace(' ', 'T'), { zone: ZONE })
  assert.ok(parsed.isValid, `bad fixture time: ${value}`)
  return parsed
}

type Checkin = { at: string; trigger: CheckinTrigger; outcome?: CheckinOutcome }

/** One game, one run, one session opened at 20:00, plus whatever was asked. */
function log(checkins: readonly Checkin[] = [], openedAt = '2026-05-03 20:00'): EventEnvelope[] {
  const events: EventEnvelope[] = [
    event('game.create', { game_id: 'G1', slug: 'hollow-knight', title: 'Hollow Knight' }),
    event('run.open', {
      run_id: 'R1',
      game_id: 'G1',
      platform: 'Switch',
      form: 'digital',
      mode: 'solo',
      started_on: '2026-05-03',
      replay: false,
    }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: at(openedAt).toISO() }),
  ]
  for (const checkin of checkins) {
    events.push(
      event('session.checkin', {
        session_id: 'S1',
        at: at(checkin.at).toISO(),
        trigger: checkin.trigger,
        outcome: checkin.outcome ?? 'snoozed',
      }),
    )
  }
  return events
}

function config(checkin: Partial<CheckinConfig> = {}): Config {
  const merged = structuredClone(DEFAULT_CONFIG)
  merged.checkin = { ...merged.checkin, ...checkin }
  return merged
}

/** The trigger that came back, or null. One row per session is the contract. */
function triggerAt(events: readonly EventEnvelope[], when: string, settings: Config = config()): string | null {
  const rows = due(fold([...events], context), settings, at(when), context)
  assert.ok(rows.length <= 1, `${rows.length} rows for one session — that is two messages about one thing`)
  return rows[0]?.trigger ?? null
}

type Case = {
  name: string
  when: string
  checkins?: Checkin[]
  settings?: Config
  openedAt?: string
  expect: CheckinTrigger | null
}

/**
 * Defaults throughout, except where a row says otherwise: `after` 4h, `clock`
 * 01:00, `chase_at` 09:00, `backoff` [2h, 3h, 5h], ceiling 3, `quiet_hours`
 * 02:00–09:00, cutoff 05:00. The session opens at 20:00 on 2026-05-03.
 */
const cases: Case[] = [
  // --- each trigger fires ---
  { name: 'nothing is due before any threshold is crossed', when: '2026-05-03 23:00', expect: null },
  { name: 'duration fires once the session has stood open for after', when: '2026-05-04 00:30', expect: 'duration' },
  {
    name: 'clock fires when a configured hour passes with the session open',
    when: '2026-05-03 23:30',
    settings: config({ after: null, clock: ['23:00'] }),
    expect: 'clock',
  },
  {
    name: 'day_cutoff fires at the cutoff and is delivered at chase_at',
    when: '2026-05-04 09:00',
    expect: 'day_cutoff',
  },

  // --- the delivery windows ---
  {
    name: 'a clock time that last passed before the session opened has not passed with it open',
    when: '2026-05-03 21:00',
    settings: config({ after: null, clock: ['19:00'] }),
    expect: null,
  },
  {
    name: 'the day_cutoff chase is withheld between the cutoff and chase_at',
    when: '2026-05-04 06:00',
    expect: null,
  },
  {
    name: 'chase_at null asks at the cutoff itself',
    when: '2026-05-04 05:00',
    settings: config({ after: null, chase_at: null }),
    expect: 'day_cutoff',
  },

  // --- quiet hours hold rather than drop ---
  {
    name: 'duration is held inside quiet hours',
    when: '2026-05-04 03:00',
    settings: config({ chase_at: '09:00', backoff: [] }),
    expect: null,
  },
  {
    name: 'the same duration trigger is returned once quiet hours end',
    when: '2026-05-04 09:30',
    settings: config({ after: '4h', chase_at: null, clock: [], backoff: [] }),
    // The day_cutoff chase was already delivered at 05:00 and asked for, so
    // what comes back at 09:30 is the duration trigger that was held at 03:00.
    checkins: [{ at: '2026-05-04 05:00', trigger: 'day_cutoff' }],
    expect: 'duration',
  },
  {
    name: 'quiet hours never suppress the day_cutoff chase',
    when: '2026-05-04 05:00',
    settings: config({ chase_at: null }),
    expect: 'day_cutoff',
  },

  // --- the backoff ladder ---
  {
    name: 'a check-in one hour ago holds the next one — the first rung is 2h',
    when: '2026-05-04 01:30',
    checkins: [{ at: '2026-05-04 00:31', trigger: 'duration' }],
    expect: null,
  },
  {
    name: 'the first rung elapses and the session is raised again',
    when: '2026-05-04 00:40',
    settings: config({ quiet_hours: [] }),
    checkins: [{ at: '2026-05-03 22:30', trigger: 'clock' }],
    expect: 'duration',
  },
  {
    name: 'the ladder escalates: after two asks the rung is 3h, not 2h',
    when: '2026-05-04 01:30',
    settings: config({ quiet_hours: [] }),
    checkins: [
      { at: '2026-05-03 22:00', trigger: 'clock' },
      { at: '2026-05-03 23:00', trigger: 'duration' },
    ],
    expect: null,
  },
  {
    name: 'a day_cutoff chase starts a backoff of its own for the other two',
    when: '2026-05-04 09:30',
    settings: config({ quiet_hours: [] }),
    checkins: [{ at: '2026-05-04 09:00', trigger: 'day_cutoff' }],
    expect: null,
  },

  // --- the ceiling ---
  {
    name: 'the ceiling is hard: a fourth noticing check-in never happens',
    when: '2026-05-04 12:00',
    settings: config({ quiet_hours: [], chase_at: null }),
    checkins: [
      { at: '2026-05-04 00:30', trigger: 'duration' },
      { at: '2026-05-04 03:00', trigger: 'duration' },
      { at: '2026-05-04 06:30', trigger: 'duration' },
      // The chase was delivered at the cutoff and answered for, so nothing
      // but the ceiling is holding the duration trigger here.
      { at: '2026-05-04 05:00', trigger: 'day_cutoff' },
    ],
    expect: null,
  },
  {
    name: 'the day_cutoff chase is exempt from the ceiling',
    when: '2026-05-04 09:00',
    checkins: [
      { at: '2026-05-04 00:30', trigger: 'duration' },
      { at: '2026-05-04 03:00', trigger: 'duration' },
      { at: '2026-05-04 06:30', trigger: 'duration' },
    ],
    expect: 'day_cutoff',
  },
  {
    name: 'day_cutoff chases count against their own budget, not the noticing one',
    when: '2026-05-04 12:00',
    settings: config({ quiet_hours: [], chase_at: null, backoff: [] }),
    checkins: [
      { at: '2026-05-04 05:00', trigger: 'day_cutoff' },
      { at: '2026-05-04 06:00', trigger: 'duration' },
    ],
    expect: 'duration',
  },
  {
    name: 'one chase per delivery slot: the same morning is never asked twice',
    when: '2026-05-04 10:00',
    checkins: [{ at: '2026-05-04 09:00', trigger: 'day_cutoff' }],
    expect: null,
  },
  {
    name: 'a session still open the next night is chased again',
    when: '2026-05-05 09:00',
    checkins: [{ at: '2026-05-04 09:00', trigger: 'day_cutoff' }],
    expect: 'day_cutoff',
  },

  // --- switched off ---
  {
    name: 'after null switches the duration trigger off entirely',
    when: '2026-05-04 00:30',
    settings: config({ after: null, clock: [] }),
    expect: null,
  },
  {
    name: 'and leaves the day_cutoff chase intact — a silent ledger still chases',
    when: '2026-05-04 09:00',
    settings: config({ after: null, clock: [] }),
    expect: 'day_cutoff',
  },
]

for (const item of cases) {
  test(`due: ${item.name}`, () => {
    assert.equal(
      triggerAt(log(item.checkins ?? [], item.openedAt), item.when, item.settings ?? config()),
      item.expect,
    )
  })
}

test('day_cutoff outranks duration: one session is one question', () => {
  const rows = due(fold(log(), context), config({ quiet_hours: [] }), at('2026-05-04 09:00'), context)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.trigger, 'day_cutoff')
})

test('a closed session is never due', () => {
  const events = log()
  events.push(event('session.close', { session_id: 'S1', at: at('2026-05-03 23:00').toISO() }))
  assert.deepEqual(due(fold(events, context), config(), at('2026-05-04 09:00'), context), [])
})

test('the row carries the facts the wording is built from, and no wording', () => {
  const rows = due(fold(log([{ at: '2026-05-03 22:00', trigger: 'clock' }]), context), config(), at('2026-05-04 09:00'), context)
  const row = rows[0]

  assert.equal(row?.session_id, 'S1')
  assert.equal(row?.game, 'Hollow Knight')
  assert.equal(row?.opened_at, at('2026-05-03 20:00').toISO())
  assert.equal(row?.open_for_minutes, 780)
  assert.equal(row?.net_minutes, 780)
  assert.equal(row?.trigger, 'day_cutoff')
  assert.equal(row?.threshold, '05:00')
  assert.equal(row?.checkins_so_far, 1)
  assert.equal(row?.last_checkin_at, at('2026-05-03 22:00').toISO())
})

test('an open break is deducted from net time while the session runs', () => {
  const events = log()
  events.push(event('break.open', { break_id: 'B1', session_id: 'S1', at: at('2026-05-03 23:00').toISO() }))

  const row = due(fold(events, context), config(), at('2026-05-04 00:30'), context)[0]
  assert.equal(row?.open_for_minutes, 270)
  assert.equal(row?.net_minutes, 180)
  assert.equal(row?.on_break, true)
})

test('two open sessions are two rows, oldest first', () => {
  const events = log()
  events.push(
    event('game.create', { game_id: 'G2', slug: 'celeste', title: 'Celeste' }),
    event('run.open', {
      run_id: 'R2',
      game_id: 'G2',
      form: 'digital',
      mode: 'solo',
      started_on: '2026-05-03',
      replay: false,
    }),
    event('session.open', { session_id: 'S2', run_id: 'R2', at: at('2026-05-03 18:00').toISO() }),
  )

  const rows = due(fold(events, context), config(), at('2026-05-04 09:00'), context)
  assert.deepEqual(
    rows.map((row) => row.session_id),
    ['S2', 'S1'],
  )
})

test('silence past the reply window is what --expire finds, and only that', () => {
  const events = log([
    { at: '2026-05-04 00:30', trigger: 'duration' },
    { at: '2026-05-04 09:00', trigger: 'day_cutoff' },
    { at: '2026-05-03 22:00', trigger: 'clock', outcome: 'break_started' },
  ])
  const state = fold(events, context)

  // 09:20 is inside the 45m window of the 09:00 ask, past the 00:30 one, and
  // the answered check-in is never a candidate however old it gets.
  const stale = staleCheckins(state, config(), at('2026-05-04 09:20'), context)
  assert.equal(stale.length, 1)
  assert.equal(stale[0]?.at, at('2026-05-04 00:30').toISO())
  assert.equal(stale[0]?.trigger, 'duration')

  assert.equal(staleCheckins(state, config(), at('2026-05-04 09:46'), context).length, 2)
})

test('a stale check-in on a closed session is still swept', () => {
  const events = log([{ at: '2026-05-03 22:00', trigger: 'clock' }])
  events.push(event('session.close', { session_id: 'S1', at: at('2026-05-03 23:00').toISO() }))

  assert.equal(staleCheckins(fold(events, context), config(), at('2026-05-04 09:00'), context).length, 1)
})

test('an amended outcome takes the record out of the sweep, which is what stops a loop', () => {
  const events = log([{ at: '2026-05-03 22:00', trigger: 'clock' }])
  const checkin = events.at(-1)
  assert.ok(checkin !== undefined)
  events.push(event('event.amend', { target: checkin.id, reason: 'reply_window_elapsed', patch: { outcome: 'no_reply' } }))

  assert.deepEqual(staleCheckins(fold(events, context), config(), at('2026-05-04 09:00'), context), [])
})
