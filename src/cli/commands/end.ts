/**
 * `gamereg end [<query>]` — close a session (docs/spec/02-cli.md).
 *
 * The query is usually omitted: with exactly one open session it is implied.
 * With several open, this returns code 3 listing them.
 */
import type { Command } from 'commander'

import { formatHm } from '../../core/duration.ts'
import { toISO } from '../../core/time.ts'
import { closeSession } from '../close-session.ts'
import { createContext } from '../context.ts'
import { clock } from '../format.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, gameOfSession, load, targetSession } from '../workspace.ts'

type Options = {
  id?: string
  break?: string
  note?: string
}

export function registerEnd(registrar: Registrar): void {
  registrar
    .command('end', 'help.end')
    .argument('[query]', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--break <duration>', registrar.t('help.opt.break'))
    .option('--note <text>', registrar.t('help.opt.note'))
    .action(async (query: string | undefined, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const session = await targetSession(cli, workspace, query ?? null, { id: options.id })
      const sessionId = session.session_id
      const game = gameOfSession(workspace.state, session)

      closeSession(cli, workspace, session, {
        at: cli.at,
        breakText: options.break,
        note: options.note,
      })

      const events = commit(cli, workspace)
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
        },
        events,
        prose,
      })
    })
}
