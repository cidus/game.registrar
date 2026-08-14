/**
 * Filing one historical run — `run.import` (docs/spec/01-model.md).
 *
 * Shared by `gamereg past` (one row, typed) and `gamereg import` (many rows,
 * from a spreadsheet): both resolve to the same event shape, so a row from a
 * CSV and a game finished from the command line are indistinguishable once
 * they land in the log.
 */
import { hoursToMinutes } from '../core/duration.ts'
import { newId } from '../core/ids.ts'
import type { GameState, RunState } from '../core/fold.ts'
import { canonicalPlatform, platformTable } from '../core/platforms.ts'
import { parseImpreciseDate, type ImpreciseDate } from '../core/time.ts'
import {
  checkEnum,
  COMPLETION_CRITERIA,
  DIFFICULTY,
  FORM,
  MODE,
  OUTCOME,
  type DatePrecision,
} from '../core/vocab.ts'
import { parseRating } from './close-run.ts'
import type { Cli } from './context.ts'
import { resolveGame, stage, type Workspace } from './workspace.ts'

export type HistoricalRunInput = {
  query: string
  id?: string
  platform?: string
  form?: string
  mode?: string
  metadata?: boolean
  ended: string
  started?: string
  hours?: string
  rating?: string
  difficulty?: string
  criteria?: string
  outcome?: string
  note?: string
}

export type HistoricalRunResult = {
  game: GameState
  run: RunState
  runId: string
  minutes: number | null
  endedText: string
}

const COARSENESS: Record<DatePrecision, number> = { year: 2, month: 1, day: 0 }

const coarser = (left: ImpreciseDate, right: ImpreciseDate): DatePrecision =>
  COARSENESS[left.precision] >= COARSENESS[right.precision] ? left.precision : right.precision

/** Everything `past` does with one row of input — resolve, validate, stage `run.import`. */
export async function fileHistoricalRun(
  cli: Cli,
  workspace: Workspace,
  input: HistoricalRunInput,
): Promise<HistoricalRunResult> {
  const ended = parseImpreciseDate(input.ended)
  const started = input.started === undefined ? ended : parseImpreciseDate(input.started)

  const outcome = input.outcome === undefined ? 'finished' : checkEnum('outcome', input.outcome, OUTCOME)
  const criteria =
    input.criteria === undefined
      ? outcome === 'finished'
        ? 'credits'
        : 'abandoned'
      : checkEnum('completion_criteria', input.criteria, COMPLETION_CRITERIA)
  const difficulty = input.difficulty === undefined ? null : checkEnum('difficulty', input.difficulty, DIFFICULTY)
  const rating = parseRating(input.rating)
  const minutes = input.hours === undefined ? null : hoursToMinutes(Number(input.hours))

  const resolved = await resolveGame(cli, workspace, input.query, {
    id: input.id,
    platform: input.platform,
    metadata: input.metadata,
    allowCreate: true,
  })
  const gameId = resolved.game_id
  const game = workspace.state.gamesById.get(gameId)!
  const last = game.runs.at(-1)

  // `past` files a run that is already closed, frequently several in a row, so
  // it never prompts: `--platform` is how you say it, and a run with none
  // stays that way until an amend says otherwise.
  const table = platformTable(cli.vault.config.platforms)
  const platform = canonicalPlatform(
    input.platform ?? last?.platform ?? cli.vault.config.defaults.platform,
    table,
  )
  const runId = newId()

  stage(cli, workspace, 'run.import', {
    run_id: runId,
    game_id: gameId,
    ...(platform === null ? {} : { platform }),
    form: input.form === undefined ? (last?.form ?? cli.vault.config.defaults.form) : checkEnum('form', input.form, FORM),
    mode: input.mode === undefined ? (last?.mode ?? cli.vault.config.defaults.mode) : checkEnum('mode', input.mode, MODE),
    started_on: started.date,
    ended_on: ended.date,
    date_precision: coarser(started, ended),
    outcome,
    completion_criteria: criteria,
    ...(rating === null ? {} : { rating }),
    ...(difficulty === null ? {} : { difficulty }),
    ...(minutes === null ? {} : { hours: minutes / 60 }),
    ...(input.note === undefined ? {} : { note: input.note }),
    replay: game.runs.length > 0,
  })

  const run = workspace.state.runsById.get(runId)!
  const final = workspace.state.gamesById.get(gameId)!

  return { game: final, run, runId, minutes, endedText: ended.text }
}
