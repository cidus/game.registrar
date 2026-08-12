/**
 * `gamereg start <query>` — open a session (docs/spec/02-cli.md).
 *
 * No network, ever: `run.open` writes what is known locally and `enrich` runs
 * later. A start command must never fail because a provider is down.
 */
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { newId } from '../../core/ids.ts'
import { logicalDay, toISO } from '../../core/time.ts'
import { createContext } from '../context.ts'
import { clock, clockOf, list } from '../format.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import {
  commit,
  gameOfSession,
  load,
  openRunOf,
  openSessionOf,
  openSessions,
  resolveGame,
  runDefaults,
  stage,
} from '../workspace.ts'

type Options = {
  id?: string
  platform?: string
  form?: string
  mode?: string
  replay?: boolean
  metadata?: boolean
}

export function registerStart(registrar: Registrar): void {
  registrar
    .command('start', 'help.start')
    .argument('<query>', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--platform <name>', registrar.t('help.opt.platform'))
    .option('--form <form>', registrar.t('help.opt.form'))
    .option('--mode <mode>', registrar.t('help.opt.mode'))
    .option('--replay', registrar.t('help.opt.replay'))
    .option('--no-metadata', registrar.t('help.opt.no_metadata'))
    .action(async (query: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const resolved = await resolveGame(cli, workspace, query, {
        id: options.id,
        platform: options.platform,
        metadata: options.metadata,
        allowCreate: true,
      })
      const gameId = resolved.game_id
      const created = workspace.pending.some((event) => event.type === 'game.create')

      // State objects are rebuilt by every fold, so read the game back by id.
      const before = workspace.state.gamesById.get(gameId)!

      // A run already open is reused; --replay forces a new one (a certified copy).
      const reusable = options.replay === true ? null : openRunOf(before)
      const alreadyOpen = reusable === null ? null : openSessionOf(reusable)
      if (alreadyOpen !== null) {
        throw new GameregError('conflict', 'error.session_already_open', {
          title: before.title,
          time: clockOf(cli, alreadyOpen.started_at),
        })
      }

      let runId = reusable?.run_id ?? null
      const openedRun = runId === null
      if (runId === null) {
        const defaults = runDefaults(cli, before, options)
        runId = newId()
        stage(cli, workspace, 'run.open', {
          run_id: runId,
          game_id: gameId,
          platform: defaults.platform,
          form: defaults.form,
          mode: defaults.mode,
          started_on: logicalDay(cli.at, cli.vault.config.day_cutoff),
          replay: before.runs.length > 0,
        })
      }

      const sessionId = newId()
      stage(cli, workspace, 'session.open', {
        session_id: sessionId,
        run_id: runId,
        at: toISO(cli.at),
      })

      const events = commit(cli, workspace)
      const game = workspace.state.gamesById.get(gameId)!
      const run = workspace.state.runsById.get(runId)!

      const others = openSessions(workspace.state)
        .filter((session) => session.session_id !== sessionId)
        .map((session) => gameOfSession(workspace.state, session).title)

      const prose: string[] = []
      if (created) prose.push(cli.t('prose.start.created', { title: game.title }))
      if (openedRun && run.replay) {
        prose.push(
          cli.t('prose.start.replay', {
            title: game.title,
            platform: run.platform,
            run: game.runs.length,
            time: clock(cli.at),
          }),
        )
      } else {
        prose.push(
          cli.t(openedRun ? 'prose.start.new_run' : 'prose.start.filed', {
            title: game.title,
            platform: run.platform,
            time: clock(cli.at),
          }),
        )
      }
      if (others.length > 0) prose.push(cli.t('prose.start.also_open', { list: list(others) }))

      emit(cli, {
        action: 'session.open',
        result: {
          game: { game_id: game.game_id, slug: game.slug, title: game.title, created },
          run_id: run.run_id,
          session_id: sessionId,
          at: toISO(cli.at),
          platform: run.platform,
          form: run.form,
          mode: run.mode,
          replay: run.replay,
          run_opened: openedRun,
        },
        events,
        prose,
      })
    })
}
