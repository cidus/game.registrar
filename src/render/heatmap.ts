/**
 * The calendar heatmap (docs/spec/04-derived.md "Heatmap and year in review").
 *
 * A pure function from folded state to a string of SVG. Inline SVG rather than
 * a chart library: it adds no runtime dependency, it renders in Obsidian, in
 * `Games.html` and in a published page, and a target can either write it as its
 * own file or paste it into a document without the renderer knowing which.
 *
 * Nothing here reads a clock. Which years exist comes from the log, and a year
 * is always drawn whole — January 1st to December 31st — so a build in December
 * and a build the following January produce the same bytes.
 */
import { formatHm } from '../core/duration.ts'
import type { VaultState } from '../core/fold.ts'
import type { Translator } from '../i18n/index.ts'

export type DayPlay = { minutes: number; sessions: number }

/** One entry per logical day actually played — `v_sessions_by_day` in code. */
export function playByDay(state: VaultState): Map<string, DayPlay> {
  const days = new Map<string, DayPlay>()
  for (const game of state.games) {
    for (const run of game.runs) {
      for (const session of run.sessions) {
        const entry = days.get(session.logical_day) ?? { minutes: 0, sessions: 0 }
        entry.minutes += session.minutes
        entry.sessions += 1
        days.set(session.logical_day, entry)
      }
    }
  }
  return days
}

/** Ascending. A year exists because a session happened in it, never because it is now. */
export function yearsPlayed(state: VaultState): number[] {
  const years = new Set<number>()
  for (const day of playByDay(state).keys()) years.add(Number(day.slice(0, 4)))
  return [...years].sort((left, right) => left - right)
}

/**
 * Fixed thresholds rather than per-year quantiles, so a cell means the same
 * thing in every year and two heatmaps can be read side by side.
 */
const THRESHOLDS = [60, 120, 240] as const

export function level(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0
  if (minutes < THRESHOLDS[0]) return 1
  if (minutes < THRESHOLDS[1]) return 2
  if (minutes < THRESHOLDS[2]) return 3
  return 4
}

const CELL = 11
const GAP = 2
const STEP = CELL + GAP
/** Room for the weekday labels on the left and the month labels on top. */
const LEFT = 28
const TOP = 18

/**
 * GitHub's own scale, and its dark variant behind a media query. An SVG
 * embedded as a file has no document to inherit a colour from, so the palette
 * has to travel inside it.
 */
const STYLE = [
  '.gr-h text{font:9px sans-serif;fill:#57606a}',
  '.gr-h rect{rx:2;ry:2}',
  '.gr-h .l0{fill:#ebedf0}',
  '.gr-h .l1{fill:#9be9a8}',
  '.gr-h .l2{fill:#40c463}',
  '.gr-h .l3{fill:#30a14e}',
  '.gr-h .l4{fill:#216e39}',
  '@media (prefers-color-scheme:dark){',
  '.gr-h text{fill:#8b949e}',
  '.gr-h .l0{fill:#161b22}',
  '.gr-h .l1{fill:#0e4429}',
  '.gr-h .l2{fill:#006d32}',
  '.gr-h .l3{fill:#26a641}',
  '.gr-h .l4{fill:#39d353}}',
].join('')

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInYear(year: number): number {
  return isLeap(year) ? 366 : 365
}

/** ISO weekday index, Monday first: dates are ISO everywhere else here too. */
function weekdayOf(time: number): number {
  return (new Date(time).getUTCDay() + 6) % 7
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

const DAY_MS = 86_400_000

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * One year as a week-per-column grid. `days` is the whole register's play by
 * logical day; anything outside the year is ignored, so every caller can pass
 * the same map.
 */
export function heatmapSvg(
  year: number,
  days: ReadonlyMap<string, DayPlay>,
  bundle: Translator,
): string {
  const start = Date.UTC(year, 0, 1)
  const total = daysInYear(year)
  const offset = weekdayOf(start)
  const columns = Math.ceil((offset + total) / 7)

  const width = LEFT + columns * STEP + GAP
  const height = TOP + 7 * STEP
  const parts: string[] = []

  // Month labels, at the column their first day falls in. A month whose label
  // would collide with the previous one is left unlabelled rather than
  // overprinted — the grid is the data, the labels are signposts.
  let labelled = -3
  for (let month = 0; month < 12; month += 1) {
    const column = Math.floor((offset + (Date.UTC(year, month, 1) - start) / DAY_MS) / 7)
    if (column - labelled < 3) continue
    labelled = column
    const label = escapeXml(bundle.t(`stats.month.${month + 1}`))
    parts.push(`<text x="${LEFT + column * STEP}" y="${TOP - 6}">${label}</text>`)
  }

  for (const [row, key] of [[0, 'mon'], [2, 'wed'], [4, 'fri']] as const) {
    const label = escapeXml(bundle.t(`stats.weekday.${key}`))
    const y = TOP + row * STEP + CELL - 2
    parts.push(`<text x="${LEFT - 6}" y="${y}" text-anchor="end">${label}</text>`)
  }

  for (let index = 0; index < total; index += 1) {
    const day = isoDay(start + index * DAY_MS)
    const play = days.get(day)
    const minutes = play?.minutes ?? 0
    const cellIndex = offset + index
    const x = LEFT + Math.floor(cellIndex / 7) * STEP
    const y = TOP + (cellIndex % 7) * STEP
    // A day with a session but no measured minutes — one still open — is drawn
    // at the lowest level rather than as an empty day. Something happened
    // there, and the grid should not claim otherwise.
    const shade = play === undefined ? 0 : Math.max(level(minutes), 1)
    const rect = `<rect class="l${shade}" x="${x}" y="${y}" width="${CELL}" height="${CELL}"`
    // A tooltip only for a day that has something to say, which keeps the file
    // to the size of what was played rather than the size of a year.
    if (play === undefined) {
      parts.push(`${rect}/>`)
      continue
    }
    parts.push(`${rect}><title>${day} · ${formatHm(minutes)}</title></rect>`)
  }

  const title = escapeXml(bundle.t('stats.heatmap.alt', { year }))
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="gr-h" role="img" aria-label="${title}"`,
    ` viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<title>${title}</title>`,
    `<style>${STYLE}</style>`,
    parts.join(''),
    '</svg>',
  ].join('')
}
