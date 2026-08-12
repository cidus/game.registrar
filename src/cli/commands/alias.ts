/**
 * `gamereg alias <query> --add <alias>`.
 *
 * Aliases are per-game and never global. Pointing an existing alias at another
 * game moves it — by appending, as always.
 */
import type { Command } from 'commander'

import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { normalize } from '../../resolve/normalize.ts'
import { commit, load, resolveGame, stage } from '../workspace.ts'

type Options = { id?: string; add: string }

export function registerAlias(registrar: Registrar): void {
  registrar
    .command('alias', 'help.alias')
    .argument('<query>', registrar.t('help.arg.query'))
    .requiredOption('--add <alias>', registrar.t('help.opt.add'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .action(async (query: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const resolved = await resolveGame(cli, workspace, query, {
        id: options.id,
        allowCreate: false,
      })
      const gameId = resolved.game_id
      const alias = normalize(options.add)

      stage(cli, workspace, 'game.alias', { game_id: gameId, alias })
      const events = commit(cli, workspace)
      const game = workspace.state.gamesById.get(gameId)!

      emit(cli, {
        action: 'game.alias',
        result: {
          game: { game_id: game.game_id, slug: game.slug, title: game.title },
          alias,
          aliases: game.aliases,
        },
        events,
        prose: [cli.t('prose.alias.added', { alias, title: game.title })],
      })
    })
}
