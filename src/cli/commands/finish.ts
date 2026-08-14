/**
 * `gamereg finish <query>` — close a run as finished (docs/spec/02-cli.md).
 *
 * The consolidated verdict is deliberately not written here.
 */
import type { Command } from 'commander'

import { formatHm } from '../../core/duration.ts'
import { closeRun, type CloseRunOptions } from '../close-run.ts'
import { createContext } from '../context.ts'
import { clock } from '../format.ts'
import { emit } from '../output.ts'
import { platformProse, rememberPlatform } from '../platform.ts'
import type { Registrar } from '../register.ts'
import { commit, load } from '../workspace.ts'

export function registerFinish(registrar: Registrar): void {
  registrar
    .command('finish', 'help.finish')
    .argument('<query>', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--rating <value>', registrar.t('help.opt.rating'))
    .option('--difficulty <token>', registrar.t('help.opt.difficulty'))
    .option('--criteria <token>', registrar.t('help.opt.criteria'))
    .option('--note <text>', registrar.t('help.opt.note'))
    .option('--platform <name>', registrar.t('help.opt.platform'))
    .action(async (query: string, options: CloseRunOptions, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const { game, run, sessionClosed, platform } = await closeRun(
        cli,
        workspace,
        query,
        options,
        'finished',
        'credits',
      )
      const events = commit(cli, workspace)
      rememberPlatform(cli, platform)

      const prose: string[] = []
      if (sessionClosed) prose.push(cli.t('prose.finish.session_closed', { time: clock(cli.at) }))
      prose.push(
        cli.t('prose.finish.approved', {
          title: game.title,
          duration: formatHm(run.minutes),
          sessions: run.sessions.length,
        }),
      )
      prose.push(
        run.rating === null
          ? cli.t('prose.finish.unrated')
          : cli.t('prose.finish.rating', { rating: run.rating }),
      )
      if (platform !== null) prose.push(platformProse(cli, platform))

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
        },
        events,
        prose,
      })
    })
}
