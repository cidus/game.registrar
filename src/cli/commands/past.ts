/**
 * `gamereg past <query>` — file a historical game (docs/spec/02-cli.md).
 *
 * Emits `run.import`: a closed run whose hours are *stated*, not measured.
 * Date precision comes from the shape of the argument, because "2011" is honest
 * and "2011-01-01" is a lie that pollutes every chart.
 *
 * Unlike `start`, a missing platform is left null rather than refused: a game
 * finished fifteen years ago is remembered as a title, not as a machine.
 */
import type { Command } from 'commander'

import { hoursToMinutes } from '../../core/duration.ts'
import { newId } from '../../core/ids.ts'
import { parseImpreciseDate, type ImpreciseDate } from '../../core/time.ts'
import {
  checkEnum,
  COMPLETION_CRITERIA,
  DIFFICULTY,
  FORM,
  MODE,
  OUTCOME,
  type DatePrecision,
} from '../../core/vocab.ts'
import { parseRating } from '../close-run.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, load, resolveGame, stage } from '../workspace.ts'

type Options = {
  id?: string
  ended: string
  started?: string
  hours?: string
  rating?: string
  difficulty?: string
  criteria?: string
  outcome?: string
  platform?: string
  form?: string
  mode?: string
  note?: string
  metadata?: boolean
}

const COARSENESS: Record<DatePrecision, number> = { year: 2, month: 1, day: 0 }

const coarser = (left: ImpreciseDate, right: ImpreciseDate): DatePrecision =>
  COARSENESS[left.precision] >= COARSENESS[right.precision] ? left.precision : right.precision

export function registerPast(registrar: Registrar): void {
  registrar
    .command('past', 'help.past')
    .argument('<query>', registrar.t('help.arg.query'))
    .requiredOption('--ended <date>', registrar.t('help.opt.ended'))
    .option('--started <date>', registrar.t('help.opt.started'))
    .option('--hours <number>', registrar.t('help.opt.hours'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--rating <value>', registrar.t('help.opt.rating'))
    .option('--difficulty <token>', registrar.t('help.opt.difficulty'))
    .option('--criteria <token>', registrar.t('help.opt.criteria'))
    .option('--outcome <token>', registrar.t('help.opt.outcome'))
    .option('--platform <name>', registrar.t('help.opt.platform'))
    .option('--form <form>', registrar.t('help.opt.form'))
    .option('--mode <mode>', registrar.t('help.opt.mode'))
    .option('--note <text>', registrar.t('help.opt.note'))
    .option('--no-metadata', registrar.t('help.opt.no_metadata'))
    .action(async (query: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const ended = parseImpreciseDate(options.ended)
      const started = options.started === undefined ? ended : parseImpreciseDate(options.started)

      const outcome =
        options.outcome === undefined ? 'finished' : checkEnum('outcome', options.outcome, OUTCOME)
      const criteria =
        options.criteria === undefined
          ? outcome === 'finished'
            ? 'credits'
            : 'abandoned'
          : checkEnum('completion_criteria', options.criteria, COMPLETION_CRITERIA)
      const difficulty =
        options.difficulty === undefined
          ? null
          : checkEnum('difficulty', options.difficulty, DIFFICULTY)
      const rating = parseRating(options.rating)
      const minutes = options.hours === undefined ? null : hoursToMinutes(Number(options.hours))

      const resolved = await resolveGame(cli, workspace, query, {
        id: options.id,
        platform: options.platform,
        metadata: options.metadata,
        allowCreate: true,
      })
      const gameId = resolved.game_id
      const game = workspace.state.gamesById.get(gameId)!
      const last = game.runs.at(-1)

      const platform = options.platform ?? last?.platform ?? cli.vault.config.defaults.platform
      const runId = newId()

      stage(cli, workspace, 'run.import', {
        run_id: runId,
        game_id: gameId,
        ...(platform === null || platform === undefined ? {} : { platform }),
        form:
          options.form === undefined
            ? (last?.form ?? cli.vault.config.defaults.form)
            : checkEnum('form', options.form, FORM),
        mode:
          options.mode === undefined
            ? (last?.mode ?? cli.vault.config.defaults.mode)
            : checkEnum('mode', options.mode, MODE),
        started_on: started.date,
        ended_on: ended.date,
        date_precision: coarser(started, ended),
        outcome,
        completion_criteria: criteria,
        ...(rating === null ? {} : { rating }),
        ...(difficulty === null ? {} : { difficulty }),
        ...(minutes === null ? {} : { hours: minutes / 60 }),
        ...(options.note === undefined ? {} : { note: options.note }),
        replay: game.runs.length > 0,
      })

      const events = commit(cli, workspace)
      const run = workspace.state.runsById.get(runId)!
      const final = workspace.state.gamesById.get(gameId)!

      const prose = [cli.t('prose.past.filed', { title: final.title, date: ended.text })]
      if (minutes !== null) {
        prose.push(cli.t('prose.past.hours', { hours: (minutes / 60).toFixed(1) }))
      }

      emit(cli, {
        action: 'run.import',
        result: {
          game: { game_id: final.game_id, slug: final.slug, title: final.title },
          run_id: runId,
          started_on: run.started_on,
          ended_on: run.ended_on,
          date_precision: run.started_precision,
          outcome: run.outcome,
          completion_criteria: run.completion_criteria,
          rating: run.rating,
          difficulty: run.difficulty,
          minutes: run.minutes,
          hours_source: run.hours_source,
          status: final.status,
        },
        events,
        prose,
      })
    })
}
