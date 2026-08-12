/**
 * Time handling (docs/spec/02-cli.md "Time parsing", 01-model "Logical day").
 *
 * Every instant crossing the log boundary is ISO 8601 with an offset. Luxon does
 * the arithmetic; nothing here uses `Date` maths.
 */
import { DateTime } from 'luxon'

import { GameregError } from './errors.ts'
import type { DatePrecision } from './vocab.ts'

export type TimeContext = {
  /** IANA zone, or null for the system zone. */
  zone: string | null
  /** `HH:MM` — when the logical day flips. */
  dayCutoff: string
  /** Injectable for tests; defaults to the real clock. */
  now?: DateTime
}

export function nowIn(context: TimeContext): DateTime {
  const base = context.now ?? DateTime.now()
  const zoned = context.zone === null ? base : base.setZone(context.zone)
  return zoned.set({ millisecond: 0 })
}

/** ISO 8601 with offset, second precision. The one format the log ever sees. */
export function toISO(instant: DateTime): string {
  const iso = instant.set({ millisecond: 0 }).toISO({ suppressMilliseconds: true })
  if (iso === null) throw new GameregError('error', 'error.bad_time', { value: String(instant) })
  return iso
}

/** Parses an instant that came out of the log, keeping its recorded offset. */
export function parseISO(value: string, context: TimeContext): DateTime {
  const parsed = DateTime.fromISO(value, { setZone: true })
  if (!parsed.isValid) throw new GameregError('error', 'error.bad_time', { value })
  return context.zone === null ? parsed : parsed.setZone(context.zone)
}

function cutoffMinutes(dayCutoff: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(dayCutoff)
  if (match === null) throw new GameregError('usage', 'error.bad_cutoff', { value: dayCutoff })
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new GameregError('usage', 'error.bad_cutoff', { value: dayCutoff })
  return hours * 60 + minutes
}

/**
 * The day a session belongs to for reporting. Playing at 03:00 counts toward the
 * previous day, which is what a person means.
 */
export function logicalDay(instant: DateTime, dayCutoff: string): string {
  const shifted =
    instant.hour * 60 + instant.minute < cutoffMinutes(dayCutoff)
      ? instant.minus({ days: 1 })
      : instant
  const date = shifted.toISODate()
  if (date === null) throw new GameregError('error', 'error.bad_time', { value: String(instant) })
  return date
}

/**
 * `--at`, in the order documented by 02-cli. Ambiguity resolves toward the past:
 * things are filed after they happen, never before.
 */
export function parseAt(input: string, context: TimeContext): DateTime {
  const value = input.trim()
  const now = nowIn(context)
  const zone = context.zone ?? now.zoneName ?? 'system'

  const relative = /^-(\d+(?:\.\d+)?)\s*(m|min|h)$/i.exec(value)
  if (relative !== null) {
    const amount = Number(relative[1])
    const unit = (relative[2] ?? 'm').toLowerCase()
    return now.minus(unit === 'h' ? { hours: amount } : { minutes: amount })
  }

  const clock = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (clock !== null) {
    const candidate = now.set({
      hour: Number(clock[1]),
      minute: Number(clock[2]),
      second: 0,
      millisecond: 0,
    })
    if (!candidate.isValid) throw new GameregError('usage', 'error.bad_time', { value })
    return candidate > now ? candidate.minus({ days: 1 }) : candidate
  }

  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})$/.exec(value)
  if (local !== null) {
    const candidate = DateTime.fromISO(`${local[1]}T${local[2]}`, { zone })
    if (!candidate.isValid) throw new GameregError('usage', 'error.bad_time', { value })
    return candidate.set({ second: 0, millisecond: 0 })
  }

  const iso = DateTime.fromISO(value, { setZone: true })
  if (iso.isValid) return iso.set({ millisecond: 0 })

  throw new GameregError('usage', 'error.bad_time', { value })
}

export type ImpreciseDate = {
  /** Normalized to the first day of the period: `2011` → `2011-01-01`. */
  date: string
  precision: DatePrecision
  /** As written by the user: `2011`, `2011-07`, `2011-07-14`. */
  text: string
}

/** Precision comes from the shape of the argument. `2011` is honest; `2011-01-01` is a lie. */
export function parseImpreciseDate(input: string): ImpreciseDate {
  const value = input.trim()
  if (/^\d{4}$/.test(value)) return { date: `${value}-01-01`, precision: 'year', text: value }
  if (/^\d{4}-\d{2}$/.test(value)) {
    const candidate = DateTime.fromISO(`${value}-01`)
    if (!candidate.isValid) throw new GameregError('usage', 'error.bad_date', { value })
    return { date: `${value}-01`, precision: 'month', text: value }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const candidate = DateTime.fromISO(value)
    if (!candidate.isValid) throw new GameregError('usage', 'error.bad_date', { value })
    return { date: value, precision: 'day', text: value }
  }
  throw new GameregError('usage', 'error.bad_date', { value })
}
