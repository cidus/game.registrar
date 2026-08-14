/**
 * Filing one historical run — `run.import` (docs/spec/01-model.md).
 *
 * Shared by `gamereg past` (one row, typed) and `gamereg import` (many rows,
 * from a spreadsheet): both resolve to the same event shape, so a row from a
 * CSV and a game finished from the command line are indistinguishable once
 * they land in the log.
 */
import type { AttachmentBundle } from './attachments.ts'
import { stageCoverFromFirst } from './attachments.ts'
import { hoursToMinutes } from '../core/duration.ts'
import { GameregError } from '../core/errors.ts'
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
import { openRunOf, resolveGame, stage, stageNewRun, type Workspace } from './workspace.ts'

export type HistoricalRunInput = {
  query: string
  id?: string
  platform?: string
  form?: string
  mode?: string
  metadata?: boolean
  /** Omitted files the run as still ongoing — requires `hours`. See `fileOpenRun`. */
  ended?: string
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
  /** Null when filed without `--ended` — there is no closing date to report. */
  endedText: string | null
}

const COARSENESS: Record<DatePrecision, number> = { year: 2, month: 1, day: 0 }

const coarser = (left: ImpreciseDate, right: ImpreciseDate): DatePrecision =>
  COARSENESS[left.precision] >= COARSENESS[right.precision] ? left.precision : right.precision

/**
 * Everything `past` does with one row of input — resolve, validate, stage
 * either `run.import` (`--ended` given: a closed, stated run) or `run.open`
 * (omitted: an ongoing run with a stated baseline, no session — see
 * `fileOpenRun` below and 02-cli.md's `past` section).
 */
export async function fileHistoricalRun(
  cli: Cli,
  workspace: Workspace,
  input: HistoricalRunInput,
  attachments: AttachmentBundle,
  asCover: boolean,
): Promise<HistoricalRunResult> {
  if (input.ended === undefined) {
    if (input.hours === undefined) throw new GameregError('usage', 'error.past_needs_ended_or_hours')
    if (
      input.rating !== undefined ||
      input.difficulty !== undefined ||
      input.criteria !== undefined ||
      input.outcome !== undefined
    ) {
      throw new GameregError('usage', 'error.past_open_run_no_completion_fields')
    }
    return fileOpenRun(cli, workspace, input, attachments, asCover)
  }

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
    ...(attachments.attachments.length === 0 ? {} : { attachments: attachments.attachments }),
  })
  if (asCover) stageCoverFromFirst(cli, workspace, gameId, attachments.photos)

  const run = workspace.state.runsById.get(runId)!
  const final = workspace.state.gamesById.get(gameId)!

  return { game: final, run, runId, minutes, endedText: ended.text }
}

/**
 * `past` without `--ended` — "estou jogando X, já tenho 30h nele" said about
 * a game nobody is sitting down to play this instant (05-agent.md,
 * *Starting*). Stages the same `run.open` that `start --past-hours` does,
 * through the same `stageNewRun` helper, but never a `session.open`: a
 * session announces "playing right now", and this command only ever
 * declares a fact about an ongoing run. Whoever actually sits down to play
 * later calls `start`, which finds this run already open and reuses it —
 * same mechanism as resuming any other paused run.
 */
async function fileOpenRun(
  cli: Cli,
  workspace: Workspace,
  input: HistoricalRunInput,
  attachments: AttachmentBundle,
  asCover: boolean,
): Promise<HistoricalRunResult> {
  const resolved = await resolveGame(cli, workspace, input.query, {
    id: input.id,
    platform: input.platform,
    metadata: input.metadata,
    allowCreate: true,
  })
  const gameId = resolved.game_id
  const game = workspace.state.gamesById.get(gameId)!

  if (openRunOf(game) !== null) {
    throw new GameregError('conflict', 'error.run_already_open', { title: game.title })
  }

  // "Não lembro quando comecei" is the common case: a guessed exact day would
  // be a lie the way `run.import`'s own date-precision rule already refuses
  // to tell. Falls back to the year, not to today — this run almost
  // certainly didn't start today, or there would be nothing to declare.
  const startedGuess =
    input.started === undefined
      ? { date: `${cli.at.year}-01-01`, precision: 'year' as DatePrecision }
      : parseImpreciseDate(input.started)

  const { run_id: runId } = stageNewRun(cli, workspace, game, {
    platform: input.platform,
    form: input.form,
    mode: input.mode,
    hours: input.hours,
    startedOn: startedGuess.date,
    startedPrecision: startedGuess.precision,
  })
  if (asCover) stageCoverFromFirst(cli, workspace, gameId, attachments.photos)

  const run = workspace.state.runsById.get(runId)!
  const final = workspace.state.gamesById.get(gameId)!
  const minutes = input.hours === undefined ? null : hoursToMinutes(Number(input.hours))

  return { game: final, run, runId, minutes, endedText: null }
}
