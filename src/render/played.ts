/**
 * "How long, and over how many sittings" — the duration clause the game note,
 * the run note and the diary all end their header line with.
 *
 * Its own file for the reason `render/assets.ts` gives: three modules need it
 * and none of them should have to import another. It was three copies until
 * one of them was wrong in a way the other two shared, which is the argument
 * for this file existing rather than a fourth copy being written.
 *
 * Two facts, and only the ones on record:
 *
 * - **Nothing measured says nothing about duration.** An open session is never
 *   estimated, and `0m` would read as a claim that no time passed.
 * - **Zero sessions is not a number worth stating.** Hours filed by `import`
 *   or `past --hours` belong to the run and to no sitting at all, so a run
 *   with stated hours and no sessions is `30h00`, full stop. The register used
 *   to say `30h00 across 0 sessions`, which is false twice over: nobody
 *   recorded zero sessions, and the hours did not come from sessions in the
 *   first place. `hours_source` is where that distinction is actually carried,
 *   and the runs table already marks such hours `(stated)`.
 *
 * The bare duration goes through no `t()` key, and that is not a D7 lapse: a
 * duration is data, formatted by `core/duration.ts` the way a release year is
 * formatted by `String()`, and the header line already pushes both of those in
 * raw. A `total_none` key holding nothing but `{duration}` would be an
 * indirection with no translator on the other end of it.
 */
import { formatHm } from '../core/duration.ts'
import type { Translator } from '../i18n/index.ts'

/**
 * The clause, or `null` when there is nothing to say. Callers push it into
 * their `·`-joined header parts, so absence has to be a value rather than an
 * empty string that would leave a dangling separator.
 */
export function timePlayed(minutes: number, sessions: number, bundle: Translator): string | null {
  if (minutes <= 0) return null
  const duration = formatHm(minutes)
  if (sessions === 0) return duration
  if (sessions === 1) return bundle.t('note.header.total_one', { duration })
  return bundle.t('note.header.total', { duration, sessions })
}
