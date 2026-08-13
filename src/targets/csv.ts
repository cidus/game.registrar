/**
 * The `csv` target (docs/spec/07-targets.md).
 *
 * Three flat files, one per level of the hierarchy. RFC 4180 quoting, LF, UTF-8
 * without BOM, a header row of English schema tokens — headers are the schema,
 * not prose, so nothing here goes through i18n.
 *
 * Columns mirror the SQLite tables of [04-derived](../../docs/spec/04-derived.md)
 * exactly, so the two targets never disagree about what a column means. Sort
 * order is fixed and documented per file rather than incidental, because a
 * spreadsheet that reorders itself between builds is a diff nobody can read.
 */
import type { GameState, RunState, SessionState, VaultState } from '../core/fold.ts'
import type { PlannedFile, Target, TargetContext } from './types.ts'

type Cell = string | number | boolean | null

/**
 * RFC 4180: a field is quoted when it contains a quote, a comma or a line
 * break, and an inner quote is doubled. Everything else is written bare.
 */
function field(value: Cell): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = String(value)
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function encodeCsv(header: readonly string[], rows: readonly Cell[][]): string {
  return [header.join(','), ...rows.map((row) => row.map(field).join(','))].join('\n')
}

const GAMES = ['game_id', 'slug', 'title', 'release_year', 'developer', 'publisher', 'status'] as const

const RUNS = [
  'run_id',
  'game_id',
  'platform',
  'form',
  'mode',
  'started_on',
  'ended_on',
  'outcome',
  'completion_criteria',
  'rating',
  'difficulty',
  'minutes',
  'hours_source',
  'replay',
] as const

const SESSIONS = [
  'session_id',
  'run_id',
  'started_at',
  'ended_at',
  'minutes',
  'logical_day',
  'note',
] as const

/** By `slug`. */
function gameRows(state: VaultState): Cell[][] {
  return [...state.games]
    .sort((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0))
    .map((game: GameState) => [
      game.game_id,
      game.slug,
      game.title,
      game.release_year,
      game.developer,
      game.publisher,
      game.status,
    ])
}

/** By `started_on`, then `run_id`. */
function runRows(state: VaultState): Cell[][] {
  const runs: RunState[] = state.games.flatMap((game) => game.runs)
  return runs
    .sort((left, right) => {
      const key = `${left.started_on}|${left.run_id}`
      const other = `${right.started_on}|${right.run_id}`
      return key < other ? -1 : key > other ? 1 : 0
    })
    .map((run) => [
      run.run_id,
      run.game_id,
      run.platform,
      run.form,
      run.mode,
      run.started_on,
      run.ended_on,
      run.outcome,
      run.completion_criteria,
      run.rating,
      run.difficulty,
      run.minutes,
      run.hours_source,
      run.replay,
    ])
}

/** By `started_at`, then `session_id`. */
function sessionRows(state: VaultState): Cell[][] {
  const sessions: SessionState[] = state.games.flatMap((game) =>
    game.runs.flatMap((run) => run.sessions),
  )
  return sessions
    .sort((left, right) => {
      const key = `${left.started_at}|${left.session_id}`
      const other = `${right.started_at}|${right.session_id}`
      return key < other ? -1 : key > other ? 1 : 0
    })
    .map((session) => [
      session.session_id,
      session.run_id,
      session.started_at,
      session.ended_at,
      // An open session contributes zero minutes and is never estimated; the
      // empty `ended_at` is what says so.
      session.minutes,
      session.logical_day,
      session.note,
    ])
}

export const csv: Target = {
  name: 'csv',
  since: 0,

  plan(state: VaultState, context: TargetContext): PlannedFile[] {
    const dir = context.config.build.csv.dir
    const at = (name: string): string => (dir === '' ? name : `${dir}/${name}`)

    return [
      { path: at('games.csv'), content: encodeCsv(GAMES, gameRows(state)), policy: 'replace' },
      { path: at('runs.csv'), content: encodeCsv(RUNS, runRows(state)), policy: 'replace' },
      { path: at('sessions.csv'), content: encodeCsv(SESSIONS, sessionRows(state)), policy: 'replace' },
    ]
  },
}
