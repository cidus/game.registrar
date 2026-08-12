/**
 * Duration arithmetic and formatting (docs/spec/01-model.md "Duration").
 *
 *   session.minutes = (close.at - open.at) - Σ(closed breaks) - close.break_minutes
 *
 * Negative is a validation error, never a clamp.
 */
import type { DateTime } from 'luxon'

import { GameregError } from './errors.ts'

/** Accepts `90`, `40m`, `2h`, `1h20`, `1h20m`, `1:20`. */
export function parseDuration(input: string): number {
  const value = input.trim().toLowerCase()

  const bare = /^(\d+)$/.exec(value)
  if (bare !== null) return Number(bare[1])

  const minutes = /^(\d+)\s*m(?:in)?$/.exec(value)
  if (minutes !== null) return Number(minutes[1])

  const hoursAndMinutes = /^(\d+)\s*h(?:\s*(\d{1,2})\s*m?)?$/.exec(value)
  if (hoursAndMinutes !== null) {
    const extra = hoursAndMinutes[2]
    const minutePart = extra === undefined ? 0 : Number(extra)
    if (minutePart > 59) throw new GameregError('usage', 'error.bad_duration', { value: input })
    return Number(hoursAndMinutes[1]) * 60 + minutePart
  }

  const colon = /^(\d+):(\d{2})$/.exec(value)
  if (colon !== null) {
    const minutePart = Number(colon[2])
    if (minutePart > 59) throw new GameregError('usage', 'error.bad_duration', { value: input })
    return Number(colon[1]) * 60 + minutePart
  }

  throw new GameregError('usage', 'error.bad_duration', { value: input })
}

/** Whole minutes between two instants. Sub-minute precision is noise here. */
export function minutesBetween(from: DateTime, to: DateTime): number {
  return Math.round(to.diff(from, 'minutes').minutes)
}

/** `2h58`, `58m`, `0m`. Locale-independent: generated blocks are data. */
export function formatHm(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return `${rest}m`
  return `${hours}h${String(rest).padStart(2, '0')}`
}

/** Fixed one decimal place, everywhere hours are written (04-derived). */
export function formatHours(minutes: number): string {
  return (Math.round(minutes) / 60).toFixed(1)
}

export function hoursToMinutes(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new GameregError('usage', 'error.bad_hours', { value: hours })
  }
  return Math.round(hours * 60)
}
