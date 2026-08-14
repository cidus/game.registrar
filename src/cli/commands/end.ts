/**
 * `gamereg end [<query>]` — close a session (docs/spec/02-cli.md).
 *
 * The query is usually omitted: with exactly one open session it is implied.
 * With several open, this returns code 3 listing them.
 */
import type { Command } from 'commander'

import { formatHm } from '../../core/duration.ts'
import { toISO } from '../../core/time.ts'
import { attachmentProse, attachmentResult, collectAttachments, stageCoverFromFirst, suggestedAtProse } from '../attachments.ts'
import { closeSession } from '../close-session.ts'
import { createContext } from '../context.ts'
import { clock } from '../format.ts'
import { emit } from '../output.ts'
import { platformProse, rememberPlatform, settlePlatform } from '../platform.ts'
import type { Registrar } from '../register.ts'
import { commit, gameOfSession, load, targetSession } from '../workspace.ts'

type Options = {
  id?: string
  break?: string
  note?: string
  platform?: string
  kind?: string
  asCover?: boolean
}

export function registerEnd(registrar: Registrar): void {
  registrar
    .command('end', 'help.end')
    .argument('[query]', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--break <duration>', registrar.t('help.opt.break'))
    .option('--note <text>', registrar.t('help.opt.note'))
    .option('--platform <name>', registrar.t('help.opt.platform'))
    .option('--photo <path>', registrar.t('help.opt.photo'))
    .option('--caption <text>', registrar.t('help.opt.caption'))
    .option('--kind <kind>', registrar.t('help.opt.kind'))
    .option('--as-cover', registrar.t('help.opt.as_cover'))
    .action(async (query: string | undefined, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)
      const bundle = await collectAttachments(cli, command, options.kind)

      const session = await targetSession(cli, workspace, query ?? null, { id: options.id })
      const sessionId = session.session_id
      const game = gameOfSession(workspace.state, session)

      closeSession(cli, workspace, session, {
        at: cli.at,
        breakText: options.break,
        note: options.note,
        attachments: bundle.attachments,
      })
      if (options.asCover === true) stageCoverFromFirst(cli, workspace, game.game_id, bundle.photos)

      // The platform question belongs here, not at `start`: by now the game has
      // usually been enriched, so the catalog can narrow it.
      const run = workspace.state.runsById.get(session.run_id)!
      const settled = await settlePlatform(cli, workspace, game, run, options.platform, 'session.close')

      const events = commit(cli, workspace)
      rememberPlatform(cli, settled)
      const closed = workspace.state.sessionsById.get(sessionId)!
      const total = workspace.state.gamesById.get(game.game_id)!.total_minutes

      const prose = [
        cli.t('prose.end.closed', {
          time: clock(cli.at),
          duration: formatHm(closed.minutes),
          total: formatHm(total),
        }),
      ]
      if (closed.break_minutes > 0) {
        prose.push(cli.t('prose.end.breaks', { duration: formatHm(closed.break_minutes) }))
      }
      if (settled !== null) prose.push(platformProse(cli, settled))
      prose.push(...attachmentProse(cli, bundle.photos, options.asCover === true))
      prose.push(...suggestedAtProse(cli, bundle.suggestedAt))

      emit(cli, {
        action: 'session.close',
        result: {
          game: { game_id: game.game_id, slug: game.slug, title: game.title },
          run_id: closed.run_id,
          session_id: sessionId,
          at: toISO(cli.at),
          minutes: closed.minutes,
          break_minutes: closed.break_minutes,
          logical_day: closed.logical_day,
          game_total_minutes: total,
          platform: workspace.state.runsById.get(closed.run_id)?.platform ?? null,
          ...(settled === null ? {} : { platform_source: settled.source }),
          ...(bundle.photos.length === 0 ? {} : { attachments: bundle.photos.map(attachmentResult) }),
        },
        events,
        prose,
      })
    })
}
