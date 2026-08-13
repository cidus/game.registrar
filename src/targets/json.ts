/**
 * The `json` target (docs/spec/07-targets.md, 04-derived.md "SQLite" — csv,
 * json and sqlite share one schema).
 *
 * `data/export.json`: the same tables, the same column names, as `csv` and
 * `sqlite`. Where any of the three disagree, the SQLite schema is right and
 * the other is the bug (04-derived.md).
 */
import { SCHEMA_VERSION } from '../core/events.ts'
import type { GameState, RunState, SessionState, VaultState } from '../core/fold.ts'
import type { PlannedFile, Target, TargetContext } from './types.ts'

type JsonGame = {
  game_id: string
  slug: string
  title: string
  release_year: number | null
  developer: string | null
  publisher: string | null
  status: string
}

type JsonRun = {
  run_id: string
  game_id: string
  platform: string | null
  form: string | null
  mode: string | null
  started_on: string
  ended_on: string | null
  outcome: string | null
  completion_criteria: string | null
  rating: number | null
  difficulty: string | null
  minutes: number
  hours_source: string
  replay: boolean
}

type JsonSession = {
  session_id: string
  run_id: string
  started_at: string
  ended_at: string | null
  minutes: number
  logical_day: string
  note: string | null
}

/** By `slug`, matching csv.ts exactly — the two targets must never disagree on order or columns. */
function games(state: VaultState): JsonGame[] {
  return [...state.games]
    .sort((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0))
    .map((game: GameState) => ({
      game_id: game.game_id,
      slug: game.slug,
      title: game.title,
      release_year: game.release_year,
      developer: game.developer,
      publisher: game.publisher,
      status: game.status,
    }))
}

/** By `started_on`, then `run_id`. */
function runs(state: VaultState): JsonRun[] {
  const all: RunState[] = state.games.flatMap((game) => game.runs)
  return all
    .sort((left, right) => {
      const key = `${left.started_on}|${left.run_id}`
      const other = `${right.started_on}|${right.run_id}`
      return key < other ? -1 : key > other ? 1 : 0
    })
    .map((run) => ({
      run_id: run.run_id,
      game_id: run.game_id,
      platform: run.platform,
      form: run.form,
      mode: run.mode,
      started_on: run.started_on,
      ended_on: run.ended_on,
      outcome: run.outcome,
      completion_criteria: run.completion_criteria,
      rating: run.rating,
      difficulty: run.difficulty,
      minutes: run.minutes,
      hours_source: run.hours_source,
      replay: run.replay,
    }))
}

/** By `started_at`, then `session_id`. */
function sessions(state: VaultState): JsonSession[] {
  const all: SessionState[] = state.games.flatMap((game) => game.runs.flatMap((run) => run.sessions))
  return all
    .sort((left, right) => {
      const key = `${left.started_at}|${left.session_id}`
      const other = `${right.started_at}|${right.session_id}`
      return key < other ? -1 : key > other ? 1 : 0
    })
    .map((session) => ({
      session_id: session.session_id,
      run_id: session.run_id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      minutes: session.minutes,
      logical_day: session.logical_day,
      note: session.note,
    }))
}

export const json: Target = {
  name: 'json',
  since: 1,

  plan(state: VaultState, _context: TargetContext): PlannedFile[] {
    const payload = {
      schema: SCHEMA_VERSION,
      games: games(state),
      runs: runs(state),
      sessions: sessions(state),
    }
    return [{ path: 'data/export.json', content: `${JSON.stringify(payload, null, 2)}\n`, policy: 'replace' }]
  },
}
