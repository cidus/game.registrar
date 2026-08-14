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

import { attachmentProse, attachmentResult, collectAttachments, suggestedAtProse } from '../attachments.ts'
import { fileHistoricalRun } from '../historical-run.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, load } from '../workspace.ts'

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
  kind?: string
  asCover?: boolean
}

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
    .option('--photo <path>', registrar.t('help.opt.photo'))
    .option('--caption <text>', registrar.t('help.opt.caption'))
    .option('--kind <kind>', registrar.t('help.opt.kind'))
    .option('--as-cover', registrar.t('help.opt.as_cover'))
    .action(async (query: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)
      const bundle = await collectAttachments(cli, command, options.kind)

      const { game, run, minutes, endedText } = await fileHistoricalRun(
        cli,
        workspace,
        {
          query,
          id: options.id,
          platform: options.platform,
          form: options.form,
          mode: options.mode,
          metadata: options.metadata,
          ended: options.ended,
          started: options.started,
          hours: options.hours,
          rating: options.rating,
          difficulty: options.difficulty,
          criteria: options.criteria,
          outcome: options.outcome,
          note: options.note,
        },
        bundle,
        options.asCover === true,
      )

      const events = commit(cli, workspace)

      const prose = [cli.t('prose.past.filed', { title: game.title, date: endedText })]
      if (minutes !== null) {
        prose.push(cli.t('prose.past.hours', { hours: (minutes / 60).toFixed(1) }))
      }
      prose.push(...attachmentProse(cli, bundle.photos, options.asCover === true))
      prose.push(...suggestedAtProse(cli, bundle.suggestedAt))

      emit(cli, {
        action: 'run.import',
        result: {
          game: { game_id: game.game_id, slug: game.slug, title: game.title },
          run_id: run.run_id,
          started_on: run.started_on,
          ended_on: run.ended_on,
          date_precision: run.started_precision,
          outcome: run.outcome,
          completion_criteria: run.completion_criteria,
          rating: run.rating,
          difficulty: run.difficulty,
          minutes: run.minutes,
          hours_source: run.hours_source,
          status: game.status,
          ...(bundle.photos.length === 0 ? {} : { attachments: bundle.photos.map(attachmentResult) }),
        },
        events,
        prose,
      })
    })
}
