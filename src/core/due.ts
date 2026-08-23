/**
 * The check-in trigger evaluator (docs/spec/05-agent.md "Check-ins").
 *
 * `Silent → Fired → Withheld → Returned` is this file, and only this file. The
 * cron wrapper asks what is due and relays the answer; the agent chooses the
 * words. Everything with a clock or a counter in it is here, per invariant 7 —
 * a language model asked to remember a 45-minute deadline across two
 * conversations will not, and a wrapper that re-derived any of this would be a
 * second implementation to disagree with the first.
 *
 * Pure over folded state, the config and an instant: no filesystem, no
 * network, no clock of its own. `--at` is therefore the whole test harness.
 *
 * The one rule this file exists to protect: **the production failure mode is
 * an assistant that nags.** It is noticed late — people mute rather than
 * complain — and by then the `day_cutoff` chase, the trigger that actually
 * recovers data, has lost its credibility along with the other two.
 */
import type { DateTime } from 'luxon'

import type { CheckinConfig, Config } from './config.ts'
import { minutesBetween, parseDuration } from './duration.ts'
import { gameOfSession, openSessions, type SessionState, type VaultState } from './fold.ts'
import { atClock, clockMinutes, parseISO, type TimeContext } from './time.ts'
import type { CheckinTrigger } from './vocab.ts'

/**
 * One open session that is due now: `gamereg open`'s row, plus which trigger
 * fired, what it fired against, and when the last question was asked.
 */
export type DueRow = {
  session_id: string
  run_id: string
  game: string
  game_id: string
  opened_at: string
  open_for_minutes: number
  net_minutes: number
  on_break: boolean
  break_started_at: string | null
  trigger: CheckinTrigger
  /** The setting that fired, as configured: `4h`, `01:00`, `05:00`. */
  threshold: string
  checkins_so_far: number
  last_checkin_at: string | null
  /** Same record as `last_checkin_at` — the *previous* question, not this one. */
  last_checkin_id: string | null
}

type Firing = {
  trigger: CheckinTrigger
  threshold: string
  /** The earliest instant the question may be *delivered*, not when it fired. */
  deliverAt: DateTime
}

/** The most recent occurrence of a time of day at or before `at`. */
function latestClock(at: DateTime, value: string): DateTime {
  const today = atClock(at, value)
  return today > at ? today.minus({ days: 1 }) : today
}

/** The first occurrence of a time of day at or after `from`. */
function nextClock(from: DateTime, value: string): DateTime {
  const today = atClock(from, value)
  return today < from ? today.plus({ days: 1 }) : today
}

/**
 * `[from, to]`, wrapping across midnight when `from` is the later of the two.
 * An empty window is no window; `from === to` is read as no window rather than
 * as a silence that lasts all day.
 */
function insideQuietHours(at: DateTime, window: readonly string[]): boolean {
  const from = window[0]
  const to = window[1]
  if (from === undefined || to === undefined) return false
  const start = clockMinutes(from)
  const end = clockMinutes(to)
  if (start === end) return false
  const minutes = at.hour * 60 + at.minute
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

/**
 * Fires once the session has stood open for `checkin.after`, and stays fired:
 * the threshold does not un-cross itself, so being *held* by quiet hours or by
 * backoff is the same thing as not being returned yet.
 *
 * Wall-clock elapsed, not net of breaks — "session open longer than" is what
 * the spec says, and a break is exactly the outcome this trigger hopes for.
 */
function fireDuration(session: SessionState, checkin: CheckinConfig, at: DateTime, time: TimeContext): Firing | null {
  if (checkin.after === null) return null
  const fired = parseISO(session.started_at, time).plus({ minutes: parseDuration(checkin.after) })
  if (fired > at) return null
  return { trigger: 'duration', threshold: checkin.after, deliverAt: fired }
}

/**
 * The most recent configured wall-clock time that passed *with this session
 * open*. A time that last came round before the session opened has not passed
 * with it open, however long ago it was.
 */
function fireClock(session: SessionState, checkin: CheckinConfig, at: DateTime, time: TimeContext): Firing | null {
  const opened = parseISO(session.started_at, time)
  let best: Firing | null = null
  for (const value of checkin.clock) {
    const fired = latestClock(at, value)
    if (fired <= opened) continue
    if (best === null || fired > best.deliverAt) {
      best = { trigger: 'clock', threshold: value, deliverAt: fired }
    }
  }
  return best
}

/**
 * Fires at `day_cutoff` with the session still open, and is delivered at the
 * next `chase_at` — two different concepts, kept as two keys. Asking at the
 * cutoff asks while the session is most likely still running; asking the next
 * morning asks about something definitively over.
 *
 * Walks back one crossing when the latest one has not been delivered yet,
 * which is the case whenever `chase_at` falls *before* the cutoff in the day.
 * Without it, a vault configured that way would go a full extra day silent.
 */
function fireDayCutoff(session: SessionState, config: Config, at: DateTime, time: TimeContext): Firing | null {
  const opened = parseISO(session.started_at, time)
  const chase = config.checkin.chase_at
  let crossing = latestClock(at, config.day_cutoff)

  for (let step = 0; step < 2; step += 1) {
    if (crossing <= opened) return null
    const deliverAt = chase === null ? crossing : nextClock(crossing, chase)
    if (deliverAt <= at) return { trigger: 'day_cutoff', threshold: config.day_cutoff, deliverAt }
    crossing = crossing.minus({ days: 1 })
  }
  return null
}

/**
 * The escalating ladder, indexed by how many questions have been asked: after
 * the first, `backoff[0]`; after the second, `backoff[1]`; past the end of the
 * list, its last entry. Measured from the last check-in of *any* trigger — a
 * `day_cutoff` chase is still a message that just arrived, and following it
 * five minutes later with "how is it going" is the nagging this prevents.
 */
function withinBackoff(session: SessionState, checkin: CheckinConfig, at: DateTime, time: TimeContext): boolean {
  const last = session.checkins.at(-1)
  if (last === undefined) return false
  if (checkin.backoff.length === 0) return false
  const step = checkin.backoff[Math.min(session.checkins.length, checkin.backoff.length) - 1]
  if (step === undefined) return false
  return parseISO(last.at, time).plus({ minutes: parseDuration(step) }) > at
}

/**
 * Which question this session is due, or none.
 *
 * At most one per session per tick: several triggers can stand fired at once,
 * and asking two questions about one session is the same nagging by another
 * route. `day_cutoff` wins because it is the only one chasing data it does not
 * have; `duration` outranks `clock` because it knows how long the session has
 * actually run, where `clock` only knows what time it is.
 */
function evaluate(session: SessionState, config: Config, at: DateTime, time: TimeContext): Firing | null {
  const checkin = config.checkin

  const chase = fireDayCutoff(session, config, at, time)
  if (chase !== null) {
    // Exempt from the ladder and from the ceiling — missing data is worth one
    // ask even after three check-ins — so the only thing that stops it is
    // having already been asked for this delivery slot.
    const asked = session.checkins.some(
      (record) => record.trigger === 'day_cutoff' && parseISO(record.at, time) >= chase.deliverAt,
    )
    if (!asked) return chase
  }

  // Quiet hours hold `duration` and `clock` rather than dropping them: both
  // fire conditions persist, so a trigger withheld at 03:00 is returned when
  // the window ends and merges into the morning message.
  if (insideQuietHours(at, checkin.quiet_hours)) return null

  // The ceiling counts only what it governs. `day_cutoff` has its own budget,
  // so three chases across three nights must not silence the other two.
  const noticing = session.checkins.filter((record) => record.trigger !== 'day_cutoff')
  if (noticing.length >= checkin.max_per_session) return null
  if (withinBackoff(session, checkin, at, time)) return null

  return fireDuration(session, checkin, at, time) ?? fireClock(session, checkin, at, time)
}

/**
 * Every open session that is due a question right now, oldest session first.
 *
 * Empty is the common answer and the important one: an assistant that pings
 * with nothing to ask gets muted within a week.
 */
export function due(state: VaultState, config: Config, at: DateTime, time: TimeContext): DueRow[] {
  const rows: DueRow[] = []

  for (const session of openSessions(state)) {
    const firing = evaluate(session, config, at, time)
    if (firing === null) continue

    const game = gameOfSession(state, session)
    const openFor = minutesBetween(parseISO(session.started_at, time), at)
    const running = session.breaks.find((item) => item.open)
    const breakMinutes = session.breaks.reduce(
      (total, item) =>
        total + (item.open ? Math.max(0, minutesBetween(parseISO(item.started_at, time), at)) : item.minutes),
      0,
    )
    const last = session.checkins.at(-1)

    rows.push({
      session_id: session.session_id,
      run_id: session.run_id,
      game: game.title,
      game_id: game.game_id,
      opened_at: session.started_at,
      open_for_minutes: Math.max(0, openFor),
      net_minutes: Math.max(0, openFor - breakMinutes),
      on_break: running !== undefined,
      break_started_at: running?.started_at ?? null,
      trigger: firing.trigger,
      threshold: firing.threshold,
      checkins_so_far: session.checkins.length,
      last_checkin_at: last?.at ?? null,
      last_checkin_id: last?.event_id ?? null,
    })
  }

  return rows.sort((first, second) => first.opened_at.localeCompare(second.opened_at))
}

/** One check-in that has stood `snoozed` past `checkin.reply_window`. */
export type StaleCheckin = {
  session_id: string
  event_id: string
  at: string
  trigger: CheckinTrigger
}

/**
 * Silence is an answer, and this is what finds the records that recorded it.
 *
 * Every session, not only the open ones: a session closed by hand while a
 * question stood unanswered leaves the same stale record, and nothing else
 * will ever come back for it.
 */
export function staleCheckins(
  state: VaultState,
  config: Config,
  at: DateTime,
  time: TimeContext,
): StaleCheckin[] {
  const window = parseDuration(config.checkin.reply_window)
  const stale: StaleCheckin[] = []

  for (const game of state.games) {
    for (const run of game.runs) {
      for (const session of run.sessions) {
        for (const record of session.checkins) {
          if (record.outcome !== 'snoozed') continue
          if (parseISO(record.at, time).plus({ minutes: window }) > at) continue
          stale.push({
            session_id: session.session_id,
            event_id: record.event_id,
            at: record.at,
            trigger: record.trigger,
          })
        }
      }
    }
  }

  return stale
}
