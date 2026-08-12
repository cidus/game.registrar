/**
 * `gamereg break start|end` — a pause inside the open session.
 *
 * Code 5 when no session is open, or when a break is already open.
 */
import type { Command } from 'commander'

import { formatHm, minutesBetween } from '../../core/duration.ts'
import { GameregError } from '../../core/errors.ts'
import { newId } from '../../core/ids.ts'
import { parseISO, toISO } from '../../core/time.ts'
import { createContext } from '../context.ts'
import { clock, clockOf } from '../format.ts'
import { emit } from '../output.ts'
import { withGlobals, type Registrar } from '../register.ts'
import { allAliases } from '../../i18n/index.ts'
import { commit, gameOfSession, load, stage, targetSession } from '../workspace.ts'

type Options = { id?: string }

function localAliases(name: string): string[] {
  const aliases: string[] = []
  for (const [alias, canonical] of allAliases().commands) {
    if (canonical === name) aliases.push(alias)
  }
  return aliases
}

export function registerBreak(registrar: Registrar): void {
  // helpCommand(false) on the program does not propagate to subcommands
  // (commander does not inherit it) — same reasoning as main.ts: its
  // wording is commander's, not the Registrar's, and cannot be localized.
  const group = registrar.command('break', 'help.break').helpCommand(false)

  const start = withGlobals(
    group.command('start').description(registrar.t('help.break_start')),
    registrar.t,
  )
    .argument('[query]', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
  for (const alias of localAliases('start')) start.alias(alias)

  start.action(async (query: string | undefined, options: Options, command: Command) => {
    const cli = createContext(command)
    const workspace = load(cli)

    const session = await targetSession(cli, workspace, query ?? null, { id: options.id })
    const sessionId = session.session_id
    const game = gameOfSession(workspace.state, session)

    const running = session.breaks.find((item) => item.open)
    if (running !== undefined) {
      throw new GameregError('conflict', 'error.break_already_open', {
        time: clockOf(cli, running.started_at),
      })
    }

    const breakId = newId()
    stage(cli, workspace, 'break.open', {
      break_id: breakId,
      session_id: sessionId,
      at: toISO(cli.at),
    })
    const events = commit(cli, workspace)

    emit(cli, {
      action: 'break.open',
      result: {
        game: { game_id: game.game_id, title: game.title },
        session_id: sessionId,
        break_id: breakId,
        at: toISO(cli.at),
      },
      events,
      prose: [cli.t('prose.break.started', { time: clock(cli.at), title: game.title })],
    })
  })

  const end = withGlobals(
    group.command('end').description(registrar.t('help.break_end')),
    registrar.t,
  )
    .argument('[query]', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
  for (const alias of localAliases('end')) end.alias(alias)

  end.action(async (query: string | undefined, options: Options, command: Command) => {
    const cli = createContext(command)
    const workspace = load(cli)

    const session = await targetSession(cli, workspace, query ?? null, { id: options.id })
    const sessionId = session.session_id
    const game = gameOfSession(workspace.state, session)

    const running = session.breaks.find((item) => item.open)
    if (running === undefined) throw new GameregError('conflict', 'error.no_open_break')

    const minutes = minutesBetween(parseISO(running.started_at, cli.time), cli.at)
    if (minutes < 0) throw new GameregError('usage', 'error.negative_duration')

    stage(cli, workspace, 'break.close', { break_id: running.break_id, at: toISO(cli.at) })
    const events = commit(cli, workspace)

    emit(cli, {
      action: 'break.close',
      result: {
        game: { game_id: game.game_id, title: game.title },
        session_id: sessionId,
        break_id: running.break_id,
        at: toISO(cli.at),
        minutes,
      },
      events,
      prose: [cli.t('prose.break.ended', { time: clock(cli.at), duration: formatHm(minutes) })],
    })
  })
}
