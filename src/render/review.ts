/**
 * The year in review, and the register-wide overview it is indexed from
 * (docs/spec/04-derived.md "Heatmap and year in review").
 *
 * Everything here is arithmetic over folded state — invariant 7, and the reason
 * a review is a build artifact at all rather than something a model writes. The
 * prose half belongs to the agent and lands *outside* the markers, where
 * invariant 3 protects it from the next build.
 *
 * No clock is read. Which years exist comes from the log.
 */
import { formatHm, formatHours } from '../core/duration.ts'
import type { GameState, RunState, SessionState, VaultState } from '../core/fold.ts'
import type { Translator } from '../i18n/index.ts'
import { heatmapSvg, playByDay, yearsPlayed, type DayPlay } from './heatmap.ts'
import { wrapBlock, type BlockContent } from './markers.ts'

export type TopTitle = {
  slug: string
  title: string
  minutes: number
  sessions: number
}

export type YearReview = {
  year: number
  sessions: number
  days_played: number
  /** Measured session minutes with a logical day inside the year. */
  minutes: number
  longest_session_minutes: number
  games_played: number
  runs_started: number
  runs_finished: number
  runs_abandoned: number
  first_session: { day: string; title: string } | null
  last_session: { day: string; title: string } | null
  /** Rating → how many runs finished that year carry it. Descending by rating. */
  ratings: { rating: number; runs: number }[]
  mean_rating: number | null
  top_titles: TopTitle[]
  /** Runs finished in the year, most recently ended first. */
  finished: { slug: string; title: string; ended_on: string; hours: string; rating: number | null }[]
}

/** Ten is the length of a list somebody reads; the rest is in the table. */
const TOP_TITLES = 10

type Played = { game: GameState; run: RunState; session: SessionState }

/** Every session, with the run and game it belongs to. Chronological, ties by ULID. */
function sessionsOf(state: VaultState): Played[] {
  const played: Played[] = []
  for (const game of state.games) {
    for (const run of game.runs) {
      for (const session of run.sessions) played.push({ game, run, session })
    }
  }
  return played.sort((left, right) => {
    const key = `${left.session.started_at}|${left.session.session_id}`
    const other = `${right.session.started_at}|${right.session.session_id}`
    return key < other ? -1 : key > other ? 1 : 0
  })
}

const yearOf = (day: string | null): number | null =>
  day === null || day.length < 4 ? null : Number(day.slice(0, 4))

/** A rating mean the way `v_by_year` computes it: two decimals, nulls ignored. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return Number((total / values.length).toFixed(2))
}

export function reviewOf(state: VaultState, year: number): YearReview {
  const played = sessionsOf(state).filter(({ session }) => yearOf(session.logical_day) === year)
  const days = new Set(played.map(({ session }) => session.logical_day))
  const minutes = played.reduce((sum, { session }) => sum + session.minutes, 0)

  const byGame = new Map<string, TopTitle>()
  for (const { game, session } of played) {
    const entry = byGame.get(game.game_id) ?? {
      slug: game.slug,
      title: game.title,
      minutes: 0,
      sessions: 0,
    }
    entry.minutes += session.minutes
    entry.sessions += 1
    byGame.set(game.game_id, entry)
  }

  const runs: { game: GameState; run: RunState }[] = state.games.flatMap((game) =>
    game.runs.map((run) => ({ game, run })),
  )
  const endedThisYear = runs.filter(({ run }) => yearOf(run.ended_on) === year)
  const finished = endedThisYear.filter(({ run }) => run.outcome === 'finished')

  const ratings = new Map<number, number>()
  for (const { run } of finished) {
    if (run.rating === null) continue
    ratings.set(run.rating, (ratings.get(run.rating) ?? 0) + 1)
  }

  const first = played[0]
  const last = played[played.length - 1]

  return {
    year,
    sessions: played.length,
    days_played: days.size,
    minutes,
    longest_session_minutes: played.reduce((top, { session }) => Math.max(top, session.minutes), 0),
    games_played: byGame.size,
    runs_started: runs.filter(({ run }) => yearOf(run.started_on) === year).length,
    runs_finished: finished.length,
    runs_abandoned: endedThisYear.filter(({ run }) => run.outcome === 'abandoned').length,
    first_session: first === undefined ? null : { day: first.session.logical_day, title: first.game.title },
    last_session: last === undefined ? null : { day: last.session.logical_day, title: last.game.title },
    ratings: [...ratings.entries()]
      .map(([rating, count]) => ({ rating, runs: count }))
      .sort((left, right) => right.rating - left.rating),
    mean_rating: mean(finished.map(({ run }) => run.rating).filter((value): value is number => value !== null)),
    top_titles: [...byGame.values()]
      .sort((left, right) =>
        right.minutes - left.minutes || (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0),
      )
      .slice(0, TOP_TITLES),
    finished: finished
      .map(({ game, run }) => ({
        slug: game.slug,
        title: game.title,
        ended_on: run.ended_on ?? '',
        hours: formatHours(run.minutes),
        rating: run.rating,
      }))
      .sort((left, right) => {
        const key = `${left.ended_on}|${left.slug}`
        const other = `${right.ended_on}|${right.slug}`
        return key < other ? 1 : key > other ? -1 : 0
      }),
  }
}

function cell(value: string | number | null): string {
  if (value === null) return ''
  return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/**
 * Cells are written as given: a row may hold a wikilink, whose own `\|` is
 * already escaped, and escaping it a second time here would show the backslash.
 * Anything that came from the user goes through `cell` at the call site.
 */
function table(head: string[], rows: (string | number | null)[][]): string {
  const text = (value: string | number | null): string => (value === null ? '' : String(value))
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(text).join(' | ')} |`),
  ].join('\n')
}

/** `2026`, the note's own basename — a year is unique enough to link bare. */
export function reviewNoteName(year: number): string {
  return String(year)
}

export function reviewNotePath(year: number): string {
  return `reviews/${reviewNoteName(year)}.md`
}

export function heatmapPath(year: number): string {
  return `reviews/heatmap-${year}.svg`
}

/**
 * A Markdown image rather than a wikilink embed, and a path relative to the
 * note's own folder: that is the one spelling Obsidian, GitHub and a static
 * site generator all resolve the same way.
 */
function heatmapEmbed(year: number, fromRoot: boolean, bundle: Translator): string {
  const path = fromRoot ? heatmapPath(year) : `heatmap-${year}.svg`
  return `![${bundle.t('stats.heatmap.alt', { year })}](${path})`
}

export const REVIEW_BLOCK_ORDER = ['summary', 'heatmap', 'top', 'ratings', 'finished'] as const

function summaryBlock(review: YearReview, bundle: Translator): string {
  const rows: (string | number | null)[][] = [
    [bundle.t('stats.review.hours'), formatHours(review.minutes)],
    [bundle.t('stats.review.sessions'), review.sessions],
    [bundle.t('stats.review.days'), review.days_played],
    [bundle.t('stats.review.games'), review.games_played],
    [bundle.t('stats.review.started'), review.runs_started],
    [bundle.t('stats.review.finished'), review.runs_finished],
    [bundle.t('stats.review.abandoned'), review.runs_abandoned],
    [bundle.t('stats.review.longest'), formatHm(review.longest_session_minutes)],
    [bundle.t('stats.review.mean_rating'), review.mean_rating === null ? '' : review.mean_rating.toFixed(2)],
  ]
  if (review.first_session !== null) {
    rows.push([
      bundle.t('stats.review.first'),
      `${review.first_session.day} · ${cell(review.first_session.title)}`,
    ])
  }
  if (review.last_session !== null) {
    rows.push([
      bundle.t('stats.review.last'),
      `${review.last_session.day} · ${cell(review.last_session.title)}`,
    ])
  }
  return table([bundle.t('stats.review.measure'), bundle.t('stats.review.value')], rows)
}

export function reviewBlocks(state: VaultState, year: number, bundle: Translator): BlockContent[] {
  const review = reviewOf(state, year)
  const days = playByDay(state)

  const top =
    review.top_titles.length === 0
      ? ''
      : table(
          [bundle.t('table.game'), bundle.t('table.hours'), bundle.t('stats.top.sessions')],
          review.top_titles.map((entry) => [
            `[[${entry.slug}\\|${cell(entry.title)}]]`,
            formatHours(entry.minutes),
            entry.sessions,
          ]),
        )

  const ratings =
    review.ratings.length === 0
      ? ''
      : table(
          [bundle.t('table.rating'), bundle.t('stats.years.runs')],
          review.ratings.map((entry) => [entry.rating, entry.runs]),
        )

  const finished =
    review.finished.length === 0
      ? ''
      : table(
          [bundle.t('table.game'), bundle.t('table.ended'), bundle.t('table.hours'), bundle.t('table.rating')],
          review.finished.map((entry) => [
            `[[${entry.slug}\\|${cell(entry.title)}]]`,
            entry.ended_on,
            entry.hours,
            entry.rating,
          ]),
        )

  return [
    { block: 'summary', content: summaryBlock(review, bundle) },
    {
      block: 'heatmap',
      content: heatmapEmbed(year, false, bundle),
      heading: bundle.t('stats.heading.heatmap'),
    },
    { block: 'top', content: top, heading: bundle.t('stats.heading.top') },
    { block: 'ratings', content: ratings, heading: bundle.t('stats.heading.ratings') },
    { block: 'finished', content: finished, heading: bundle.t('stats.heading.finished') },
  ]
}

export function reviewFrontmatter(year: number): string {
  return [`gamereg_year: ${year}`, `title: ${year}`, 'tags: [gamereg, gamereg/review]'].join('\n')
}

/** The whole note as it would be created from nothing. Prose goes between the blocks. */
export function newReview(state: VaultState, year: number, bundle: Translator): string {
  const body = reviewBlocks(state, year, bundle)
    .filter((entry) => entry.content.trim() !== '')
    .map((entry) =>
      entry.heading === undefined
        ? wrapBlock(entry.block, entry.content)
        : `## ${entry.heading}\n\n${wrapBlock(entry.block, entry.content)}`,
    )
    .join('\n\n')

  const title = bundle.t('stats.review.title', { year })
  return `---\n${reviewFrontmatter(year)}\n---\n\n# ${title}\n\n${body}\n`
}

/* ------------------------------------------------------------------ overview */

export type YearRow = {
  year: number
  sessions: number
  days: number
  minutes: number
  games: number
  finished: number
  mean_rating: number | null
}

export function yearRows(state: VaultState): YearRow[] {
  return yearsPlayed(state)
    .map((year) => {
      const review = reviewOf(state, year)
      return {
        year,
        sessions: review.sessions,
        days: review.days_played,
        minutes: review.minutes,
        games: review.games_played,
        finished: review.runs_finished,
        mean_rating: review.mean_rating,
      }
    })
    .sort((left, right) => right.year - left.year)
}

export type GenreRow = { genre: string; runs: number; minutes: number; mean_rating: number | null }

/** `v_by_genre` in code: finished runs only, one row per genre of their game. */
export function genreRows(state: VaultState): GenreRow[] {
  const byGenre = new Map<string, { runs: number; minutes: number; ratings: number[] }>()
  for (const game of state.games) {
    for (const run of game.runs) {
      if (run.outcome !== 'finished') continue
      for (const genre of game.genres) {
        const entry = byGenre.get(genre) ?? { runs: 0, minutes: 0, ratings: [] }
        entry.runs += 1
        entry.minutes += run.minutes
        if (run.rating !== null) entry.ratings.push(run.rating)
        byGenre.set(genre, entry)
      }
    }
  }
  return [...byGenre.entries()]
    .map(([genre, entry]) => ({
      genre,
      runs: entry.runs,
      minutes: entry.minutes,
      mean_rating: mean(entry.ratings),
    }))
    .sort((left, right) => (left.genre < right.genre ? -1 : left.genre > right.genre ? 1 : 0))
}

export type Totals = {
  games: number
  runs: number
  finished: number
  minutes: number
  sessions: number
  days_played: number
}

export function totalsOf(state: VaultState): Totals {
  const runs = state.games.flatMap((game) => game.runs)
  const days: ReadonlyMap<string, DayPlay> = playByDay(state)
  return {
    games: state.games.length,
    runs: runs.length,
    finished: runs.filter((run) => run.outcome === 'finished').length,
    minutes: state.games.reduce((sum, game) => sum + game.total_minutes, 0),
    sessions: runs.reduce((sum, run) => sum + run.sessions.length, 0),
    days_played: days.size,
  }
}

export const STATS_BLOCK_ORDER = ['totals', 'years', 'genres', 'heatmaps'] as const

export function statsBlocks(state: VaultState, bundle: Translator): BlockContent[] {
  const totals = totalsOf(state)
  const years = yearRows(state)

  const totalsTable = table(
    [bundle.t('stats.review.measure'), bundle.t('stats.review.value')],
    [
      [bundle.t('stats.totals.games'), totals.games],
      [bundle.t('stats.totals.runs'), totals.runs],
      [bundle.t('stats.totals.finished'), totals.finished],
      [bundle.t('stats.totals.hours'), formatHours(totals.minutes)],
      [bundle.t('stats.totals.sessions'), totals.sessions],
      [bundle.t('stats.totals.days'), totals.days_played],
    ],
  )

  const yearsTable =
    years.length === 0
      ? bundle.t('table.empty')
      : table(
          [
            bundle.t('stats.years.year'),
            bundle.t('table.hours'),
            bundle.t('stats.top.sessions'),
            bundle.t('stats.review.days'),
            bundle.t('stats.review.games'),
            bundle.t('stats.review.finished'),
            bundle.t('table.rating'),
          ],
          years.map((row) => [
            `[[${row.year}]]`,
            formatHours(row.minutes),
            row.sessions,
            row.days,
            row.games,
            row.finished,
            row.mean_rating === null ? '' : row.mean_rating.toFixed(2),
          ]),
        )

  const genres = genreRows(state)
  const genresTable =
    genres.length === 0
      ? ''
      : table(
          [bundle.t('stats.genres.genre'), bundle.t('stats.years.runs'), bundle.t('table.hours'), bundle.t('table.rating')],
          genres.map((row) => [
            cell(row.genre),
            row.runs,
            formatHours(row.minutes),
            row.mean_rating === null ? '' : row.mean_rating.toFixed(2),
          ]),
        )

  const heatmaps = years
    .map((row) => `### ${row.year}\n\n${heatmapEmbed(row.year, true, bundle)}`)
    .join('\n\n')

  return [
    { block: 'totals', content: totalsTable, heading: bundle.t('stats.heading.totals') },
    { block: 'years', content: yearsTable, heading: bundle.t('stats.heading.years') },
    { block: 'genres', content: genresTable, heading: bundle.t('stats.heading.genres') },
    { block: 'heatmaps', content: heatmaps, heading: bundle.t('stats.heading.heatmap') },
  ]
}

export function newStats(state: VaultState, bundle: Translator): string {
  const body = statsBlocks(state, bundle)
    .filter((entry) => entry.content.trim() !== '')
    .map((entry) =>
      entry.heading === undefined
        ? wrapBlock(entry.block, entry.content)
        : `## ${entry.heading}\n\n${wrapBlock(entry.block, entry.content)}`,
    )
    .join('\n\n')

  return `# ${bundle.t('stats.title')}\n\n${body}\n`
}

/** The SVG for one year, as its own file. The renderer does not know it is one. */
export function heatmapFor(state: VaultState, year: number, bundle: Translator): string {
  return heatmapSvg(year, playByDay(state), bundle)
}
