/**
 * "How long, and where the time came from" — the duration clauses the game
 * note, the run note and the diary all end their header line with.
 *
 * Its own file for the reason `render/assets.ts` gives: three modules need it
 * and none of them should have to import another. It was three copies until
 * one of them was wrong in a way the other two shared, which is the argument
 * for this file existing rather than a fourth copy being written.
 *
 * **A stated portion is never rendered as if it were measured.** That is
 * 01-model.md's rule for `hours_source`, written there as a requirement on
 * reports, and this is where the notes keep it. Hours filed by `import`,
 * `past` or `start --past-hours` are a baseline on the run; minutes from
 * sessions are measured. `run.minutes` is the sum of the two, so a header that
 * spends the sum on a sentence about sessions credits sittings that never
 * happened — which is what `30h00 across 0 sessions` did, and what
 * `28h58 across 3 sessions` would do to a run whose first 20h00 predate the
 * register.
 *
 * So each number is returned with its own provenance, as its own part:
 *
 * | Run | Clauses |
 * |---|---|
 * | measured only | `8h58 across 3 sessions` |
 * | stated only | `30h00 (stated)` |
 * | mixed | `20h00 (stated)`, `8h58 across 3 sessions` |
 * | nothing measured, nothing stated | none at all |
 *
 * The caller joins them into its own `·`-separated line, so the total is not
 * printed here and is not meant to be: it is a sum of two numbers of different
 * kinds, and it is already carried where a sum belongs — `hours` in
 * frontmatter, the `Hours` column of the consolidated table, and the `runs`
 * and `games` tables of the derived layer.
 *
 * The marker is `table.stated_marker`, the same key the consolidated table
 * puts after a run's hours, rather than a phrase of this module's own. Two
 * spellings of one idea is how a vocabulary drifts, and the parenthetical has
 * a second virtue: it does not inflect. A key like `"{duration} declaradas"`
 * agrees with *horas* and then reads wrong the first time a baseline is filed
 * in minutes.
 *
 * The bare durations go through no key of their own, and that is not a D7
 * lapse: a duration is data, formatted by `core/duration.ts` the way a release
 * year is formatted by `String()`, and the header line already pushes both of
 * those in raw.
 */
import { formatHm } from '../core/duration.ts'
import type { Translator } from '../i18n/index.ts'

/**
 * The clauses, in order, or an empty array when there is nothing on record to
 * say. Callers spread the result into their header parts, so "nothing to say"
 * has to be an absence rather than an empty string that would leave a dangling
 * separator.
 *
 * `minutes` is the run's (or game's) total and `stated` the baseline portion
 * of it, exactly as `RunState.minutes` and `RunState.stated_minutes` carry
 * them; what is left is what the sessions measured. Never `0m` for either
 * half: an open session is not estimated, and a zero would read as a claim
 * that no time passed.
 */
export function timePlayed(
  minutes: number,
  sessions: number,
  stated: number,
  bundle: Translator,
): string[] {
  const parts: string[] = []
  if (stated > 0) parts.push(`${formatHm(stated)} (${bundle.t('table.stated_marker')})`)

  const measured = minutes - stated
  if (measured > 0) {
    parts.push(
      sessions === 1
        ? bundle.t('note.header.total_one', { duration: formatHm(measured) })
        : bundle.t('note.header.total', { duration: formatHm(measured), sessions }),
    )
  }

  return parts
}
