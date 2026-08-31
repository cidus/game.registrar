/** `gamereg status [<query>]` — vault summary, or one game's state. Never writes. */
import type { Command } from 'commander'

import { formatHm, formatHours } from '../../core/duration.ts'
import { createContext } from '../context.ts'
import { list } from '../format.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { load, resolveGame } from '../workspace.ts'

type Options = { id?: string }

export function registerStatus(registrar: Registrar): void {
  registrar
    .command('status', 'help.status')
    .argument('[query]', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .action(async (query: string | undefined, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      if (query === undefined && options.id === undefined) {
        const games = workspace.state.games
        const runs = games.flatMap((game) => game.runs)
        const minutes = games.reduce((total, game) => total + game.total_minutes, 0)
        const playing = games.filter((game) => game.status === 'playing')

        const prose = [
          cli.t('prose.status.vault', {
            games: games.length,
            runs: runs.length,
            hours: formatHours(minutes),
          }),
        ]
        if (playing.length > 0) {
          prose.push(cli.t('prose.status.playing', { list: list(playing.map((game) => game.title)) }))
        }

        emit(cli, {
          action: 'status',
          result: {
            games: games.length,
            runs: runs.length,
            open_runs: runs.filter((run) => run.open).length,
            minutes,
            hours: Number(formatHours(minutes)),
            playing: playing.map((game) => ({ game_id: game.game_id, title: game.title })),
          },
          events: [],
          prose,
        })
        return
      }

      const game = await resolveGame(cli, workspace, query ?? null, {
        id: options.id,
        allowCreate: false,
      })

      const prose = [
        cli.t('prose.status.game', {
          title: game.title,
          status: cli.label('status', game.status),
          hours: formatHours(game.total_minutes),
          runs: game.runs.length,
        }),
        ...game.runs.map((run, index) =>
          cli.t(run.open ? 'prose.status.run_open' : 'prose.status.run', {
            index: index + 1,
            started: run.started_on,
            ended: run.ended_on ?? '',
            duration: formatHm(run.minutes),
            sessions: run.sessions.length,
          }),
        ),
      ]

      emit(cli, {
        action: 'status',
        result: {
          game: {
            game_id: game.game_id,
            slug: game.slug,
            title: game.title,
            status: game.status,
            platforms: game.platforms,
            aliases: game.aliases,
            minutes: game.total_minutes,
            hours: Number(formatHours(game.total_minutes)),
          },
          runs: game.runs.map((run) => ({
            run_id: run.run_id,
            // The event `amend` takes to correct this run's own fields — its
            // platform, or the stated `hours` baseline. `run_id` is an entity
            // id and is not accepted there. See `gamereg open`.
            run_open_event_id: run.open_event_id,
            platform: run.platform,
            started_on: run.started_on,
            ended_on: run.ended_on,
            outcome: run.outcome,
            completion_criteria: run.completion_criteria,
            rating: run.rating,
            difficulty: run.difficulty,
            minutes: run.minutes,
            hours_source: run.hours_source,
            open: run.open,
            sessions: run.sessions.length,
          })),
        },
        events: [],
        prose,
      })
    })
}
