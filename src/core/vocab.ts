/**
 * Controlled vocabularies (docs/spec/01-model.md).
 *
 * Stored values are these English tokens. Display labels live in i18n.
 * An unknown token is a validation error, never a warning.
 */
import { GameregError } from './errors.ts'

export const OUTCOME = ['finished', 'abandoned'] as const
export const COMPLETION_CRITERIA = [
  'credits',
  'true_ending',
  'full_completion',
  'platinum',
  'enough',
  'endless',
  'abandoned',
] as const
export const DIFFICULTY = ['trivial', 'easy', 'normal', 'hard', 'brutal'] as const
export const FORM = ['physical', 'digital', 'emulator', 'subscription', 'borrowed', 'cloud', 'demo'] as const
export const MODE = ['solo', 'coop', 'versus', 'mixed'] as const
export const DATE_PRECISION = ['day', 'month', 'year'] as const
export const ATTACHMENT_KIND = ['screenshot', 'photo', 'box', 'media', 'other'] as const
export const EVENT_SOURCE = ['cli', 'chat', 'cron', 'import'] as const
export const CHECKIN_TRIGGER = ['duration', 'clock', 'day_cutoff'] as const
export const CHECKIN_OUTCOME = ['snoozed', 'break_started', 'session_closed', 'no_reply'] as const
export const GAME_STATUS = ['unplayed', 'playing', 'finished', 'abandoned'] as const
export const HOURS_SOURCE = ['measured', 'stated', 'mixed'] as const
export const BUILD_TARGET = ['obsidian', 'csv', 'sqlite', 'json', 'html', 'stats', 'quartz'] as const

export type Outcome = (typeof OUTCOME)[number]
export type CompletionCriteria = (typeof COMPLETION_CRITERIA)[number]
export type Difficulty = (typeof DIFFICULTY)[number]
export type Form = (typeof FORM)[number]
export type Mode = (typeof MODE)[number]
export type DatePrecision = (typeof DATE_PRECISION)[number]
export type AttachmentKind = (typeof ATTACHMENT_KIND)[number]
export type EventSource = (typeof EVENT_SOURCE)[number]
export type CheckinTrigger = (typeof CHECKIN_TRIGGER)[number]
export type CheckinOutcome = (typeof CHECKIN_OUTCOME)[number]
export type GameStatus = (typeof GAME_STATUS)[number]
export type HoursSource = (typeof HOURS_SOURCE)[number]
export type BuildTarget = (typeof BUILD_TARGET)[number]

/**
 * The phase in which each build target becomes available
 * (docs/spec/07-targets.md). Naming a later one is a usage error, not an
 * unknown name: the vocabulary is complete, the implementation is not.
 */
export const TARGET_PHASE: Record<BuildTarget, 0 | 1 | 3> = {
  obsidian: 0,
  csv: 0,
  sqlite: 1,
  json: 1,
  html: 1,
  stats: 3,
  quartz: 3,
}

export const CURRENT_PHASE = 3

/**
 * Inside the current phase, and still not built. A phase is delivered in steps,
 * so between two of them a target can be current and absent at once — `quartz`
 * is exactly that until phase 3's site step lands.
 *
 * It is written here rather than derived from `targets/registry.ts` because
 * `core/` does not depend on `targets/`; `test/targets.test.ts` asserts the two
 * never disagree, so the duplication cannot rot.
 */
export const UNBUILT_TARGETS: readonly BuildTarget[] = ['quartz']

export function checkTarget(value: string): BuildTarget {
  const name = checkEnum('build.targets', value, BUILD_TARGET)
  if (TARGET_PHASE[name] > CURRENT_PHASE) {
    throw new GameregError('usage', 'error.target_phase', {
      name,
      phase: TARGET_PHASE[name],
      current: CURRENT_PHASE,
    })
  }
  // Refused where it is named, not where it would have been built: `init` and
  // the config reader both go through here, so a vault never comes to hold a
  // target this version cannot write.
  if (UNBUILT_TARGETS.includes(name)) {
    throw new GameregError('usage', 'error.unimplemented_target', { name })
  }
  return name
}

/** Ratings are 0–11. 11 means the game exceeded the scale; never clamp it. */
export const RATING_MIN = 0
export const RATING_MAX = 11

/**
 * Validates a token against a vocabulary. The thrown error lists every valid
 * token, because the caller may be a person who guessed, or an agent that
 * hallucinated — both are helped by the same list.
 */
export function checkEnum<T extends string>(
  field: string,
  value: string,
  vocabulary: readonly T[],
): T {
  if ((vocabulary as readonly string[]).includes(value)) return value as T
  throw new GameregError('usage', 'error.enum', {
    field,
    value,
    valid: vocabulary.join(', '),
  })
}

export function checkRating(value: number): number {
  if (!Number.isInteger(value) || value < RATING_MIN || value > RATING_MAX) {
    throw new GameregError('usage', 'error.rating', {
      value,
      min: RATING_MIN,
      max: RATING_MAX,
    })
  }
  return value
}
