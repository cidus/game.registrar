/**
 * `gamereg attach <target> --photo <path>` — retroactive attachment
 * (docs/spec/02-cli.md).
 *
 * `<target>` is an event id already on record, or a game query — in which
 * case it attaches to the game rather than to a moment. Inline `attachments[]`
 * on the original event is the normal path; this is for "forgot to send the
 * photo" (01-model.md).
 */
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { gameOfEvent } from '../../core/fold.ts'
import { attachmentResult, collectAttachments } from '../attachments.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, load, resolveGame, stage } from '../workspace.ts'

type Options = { kind?: string }

export function registerAttach(registrar: Registrar): void {
  registrar
    .command('attach', 'help.attach')
    .argument('<target>', registrar.t('help.arg.attach_target'))
    .option('--photo <path>', registrar.t('help.opt.photo'))
    .option('--caption <text>', registrar.t('help.opt.caption'))
    .option('--kind <kind>', registrar.t('help.opt.kind'))
    .action(async (target: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)
      const bundle = await collectAttachments(cli, command, options.kind)
      if (bundle.attachments.length === 0) {
        throw new GameregError('usage', 'error.no_photo_to_attach')
      }

      const event = workspace.state.eventsById.get(target)
      let attachTarget: string
      let title: string
      if (event !== undefined) {
        attachTarget = event.id
        title = gameOfEvent(workspace.state, event)?.title ?? event.type
      } else {
        const game = await resolveGame(cli, workspace, target, { allowCreate: false })
        attachTarget = game.game_id
        title = game.title
      }

      stage(cli, workspace, 'attachment.add', { target: attachTarget, attachments: bundle.attachments })
      const events = commit(cli, workspace)

      emit(cli, {
        action: 'attachment.add',
        result: { target: attachTarget, attachments: bundle.photos.map(attachmentResult) },
        events,
        prose: [cli.t('prose.attach.done', { title })],
      })
    })
}
