/**
 * `gamereg drop <query>` — abandon a run.
 *
 * Same shape as `finish`, with `outcome: abandoned` and `abandoned` as the
 * default criteria. A rating is optional: refusing to rate is data.
 */
import type { Command } from 'commander'

import { formatHm } from '../../core/duration.ts'
import { attachmentProse, attachmentResult, collectAttachments, suggestedAtProse } from '../attachments.ts'
import { closeRun, type CloseRunOptions } from '../close-run.ts'
import { createContext } from '../context.ts'
import { clock } from '../format.ts'
import { emit } from '../output.ts'
import { platformProse, rememberPlatform } from '../platform.ts'
import type { Registrar } from '../register.ts'
import { commit, load } from '../workspace.ts'

type Options = CloseRunOptions & { reason?: string; kind?: string; asCover?: boolean }

export function registerDrop(registrar: Registrar): void {
  registrar
    .command('drop', 'help.drop')
    .argument('<query>', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--rating <value>', registrar.t('help.opt.rating'))
    .option('--difficulty <token>', registrar.t('help.opt.difficulty'))
    .option('--criteria <token>', registrar.t('help.opt.criteria'))
    .option('--reason <text>', registrar.t('help.opt.reason'))
    .option('--platform <name>', registrar.t('help.opt.platform'))
    .option('--photo <path>', registrar.t('help.opt.photo'))
    .option('--caption <text>', registrar.t('help.opt.caption'))
    .option('--kind <kind>', registrar.t('help.opt.kind'))
    .option('--as-cover', registrar.t('help.opt.as_cover'))
    .action(async (query: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)
      const bundle = await collectAttachments(cli, command, options.kind)

      const { game, run, sessionClosed, platform } = await closeRun(
        cli,
        workspace,
        query,
        { ...options, note: options.reason },
        'abandoned',
        'abandoned',
        bundle,
        options.asCover === true,
      )
      const events = commit(cli, workspace)
      rememberPlatform(cli, platform)

      const prose: string[] = []
      if (sessionClosed) prose.push(cli.t('prose.finish.session_closed', { time: clock(cli.at) }))
      prose.push(
        cli.t('prose.drop.archived', {
          title: game.title,
          duration: formatHm(run.minutes),
          sessions: run.sessions.length,
        }),
      )
      if (options.reason !== undefined) {
        prose.push(cli.t('prose.drop.reason', { reason: options.reason }))
      }
      if (platform !== null) prose.push(platformProse(cli, platform))
      prose.push(...attachmentProse(cli, bundle.photos, options.asCover === true))
      prose.push(...suggestedAtProse(cli, bundle.suggestedAt))

      emit(cli, {
        action: 'run.close',
        result: {
          game: { game_id: game.game_id, slug: game.slug, title: game.title },
          run_id: run.run_id,
          platform: run.platform,
          ...(platform === null ? {} : { platform_source: platform.source }),
          outcome: run.outcome,
          completion_criteria: run.completion_criteria,
          rating: run.rating,
          difficulty: run.difficulty,
          ended_on: run.ended_on,
          minutes: run.minutes,
          sessions: run.sessions.length,
          status: game.status,
          ...(bundle.photos.length === 0 ? {} : { attachments: bundle.photos.map(attachmentResult) }),
        },
        events,
        prose,
      })
    })
}
