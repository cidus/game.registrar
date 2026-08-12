/**
 * Closing a run, shared by `finish` and `drop`.
 *
 * If a session is still open it is closed first, at the same instant. The
 * consolidated verdict is not written here — that is a separate step.
 */
import { GameregError } from '../core/errors.ts'
import type { GameState, RunState } from '../core/fold.ts'
import { logicalDay, toISO } from '../core/time.ts'
import {
  checkEnum,
  checkRating,
  COMPLETION_CRITERIA,
  DIFFICULTY,
  type CompletionCriteria,
  type Outcome,
} from '../core/vocab.ts'
import { closeSession } from './close-session.ts'
import type { Cli } from './context.ts'
import { openRunOf, openSessionOf, resolveGame, stage, type Workspace } from './workspace.ts'

export type CloseRunOptions = {
  id?: string
  rating?: string
  difficulty?: string
  criteria?: string
  note?: string
}

export type CloseRunResult = {
  game: GameState
  run: RunState
  sessionClosed: boolean
}

/** `--rating 9`, `--rating none`. Refusing to rate is data. */
export function parseRating(value: string | undefined): number | null {
  if (value === undefined) return null
  const text = value.trim().toLowerCase()
  if (text === 'none' || text === 'null' || text === '-') return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed)) {
    throw new GameregError('usage', 'error.rating', { value, min: 0, max: 11 })
  }
  return checkRating(parsed)
}

export async function closeRun(
  cli: Cli,
  workspace: Workspace,
  query: string,
  options: CloseRunOptions,
  outcome: Outcome,
  defaultCriteria: CompletionCriteria,
): Promise<CloseRunResult> {
  const resolved = await resolveGame(cli, workspace, query, { id: options.id, allowCreate: false })
  const gameId = resolved.game_id

  const run = openRunOf(workspace.state.gamesById.get(gameId)!)
  if (run === null) {
    throw new GameregError('conflict', 'error.no_open_run', { title: resolved.title })
  }
  const runId = run.run_id

  const openSession = openSessionOf(run)
  if (openSession !== null) closeSession(cli, workspace, openSession, { at: cli.at })

  const criteria =
    options.criteria === undefined
      ? defaultCriteria
      : checkEnum('completion_criteria', options.criteria, COMPLETION_CRITERIA)
  const difficulty =
    options.difficulty === undefined ? null : checkEnum('difficulty', options.difficulty, DIFFICULTY)
  const rating = parseRating(options.rating)

  stage(cli, workspace, 'run.close', {
    run_id: runId,
    ended_on: logicalDay(cli.at, cli.vault.config.day_cutoff),
    date_precision: 'day',
    outcome,
    completion_criteria: criteria,
    ...(rating === null ? {} : { rating }),
    ...(difficulty === null ? {} : { difficulty }),
    ...(options.note === undefined ? {} : { note: options.note }),
    at: toISO(cli.at),
  })

  return {
    game: workspace.state.gamesById.get(gameId)!,
    run: workspace.state.runsById.get(runId)!,
    sessionClosed: openSession !== null,
  }
}
