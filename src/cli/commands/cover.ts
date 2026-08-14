/**
 * `gamereg cover <query>` — set, promote or reset a game's cover
 * (docs/spec/02-cli.md).
 *
 * `--photo` ingests a new file and promotes it; `--from` promotes a hash
 * already on this game's timeline; `--reset` gives provider art back. A user
 * cover is never replaced by `enrich`, `--covers --force` included
 * (01-model.md "Cover precedence") — only this command's `--reset` undoes it.
 */
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { attachmentsOfGame } from '../../core/fold.ts'
import { collectAttachments } from '../attachments.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, load, resolveGame, stage } from '../workspace.ts'

type Options = { id?: string; from?: string; reset?: boolean; kind?: string }

export function registerCover(registrar: Registrar): void {
  registrar
    .command('cover', 'help.cover')
    .argument('<query>', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--photo <path>', registrar.t('help.opt.photo'))
    .option('--kind <kind>', registrar.t('help.opt.kind'))
    .option('--from <hash>', registrar.t('help.opt.from'))
    .option('--reset', registrar.t('help.opt.reset'))
    .action(async (query: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)
      const bundle = await collectAttachments(cli, command, options.kind)

      const sourceCount = (bundle.photos.length > 0 ? 1 : 0) + (options.from !== undefined ? 1 : 0) + (options.reset === true ? 1 : 0)
      if (sourceCount === 0) throw new GameregError('usage', 'error.cover_needs_source')
      if (sourceCount > 1) throw new GameregError('usage', 'error.cover_too_many_sources')

      const game = await resolveGame(cli, workspace, query, { id: options.id, allowCreate: false })
      const gameId = game.game_id

      let action: 'set' | 'promoted' | 'reset'
      if (options.reset === true) {
        stage(cli, workspace, 'game.cover', { game_id: gameId, source: 'provider' })
        action = 'reset'
      } else if (options.from !== undefined) {
        const known = attachmentsOfGame(workspace.state, game).some(
          (entry) => entry.attachment.sha256 === options.from,
        )
        if (!known) throw new GameregError('not_found', 'error.unknown_attachment', { title: game.title, value: options.from })
        stage(cli, workspace, 'game.cover', { game_id: gameId, sha256: options.from, source: 'user' })
        action = 'promoted'
      } else {
        const photo = bundle.photos[0]!
        stage(cli, workspace, 'attachment.add', { target: gameId, attachments: [photo.attachment] })
        stage(cli, workspace, 'game.cover', { game_id: gameId, sha256: photo.attachment.sha256, source: 'user' })
        action = 'set'
      }

      const events = commit(cli, workspace)
      const cover = workspace.state.gamesById.get(gameId)!.cover

      emit(cli, {
        action: 'game.cover',
        result: { game: { game_id: game.game_id, slug: game.slug, title: game.title }, cover },
        events,
        prose: [cli.t(`prose.cover.${action}`, { title: game.title })],
      })
    })
}
