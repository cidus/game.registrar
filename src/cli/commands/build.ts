/** `gamereg build` — regenerate every derived artifact. Idempotent. */
import type { Command } from 'commander'

import { fold } from '../../core/fold.ts'
import { readEvents } from '../../core/events.ts'
import { translator } from '../../i18n/index.ts'
import { build } from '../../render/build.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'

type Options = { force?: boolean }

export function registerBuild(registrar: Registrar): void {
  registrar
    .command('build', 'help.build')
    .option('--force', registrar.t('help.opt.force'))
    .action(async (options: Options, command: Command) => {
      const cli = createContext(command)

      const state = fold(readEvents(cli.vault.eventsFile), cli.time)
      const result = cli.dryRun
        ? { notes: [], written: [], removed: [], table: cli.vault.tableFile }
        : build(cli.vault, state, translator(cli.locale), { force: options.force === true })

      const prose = [
        cli.t('prose.build.done', { notes: result.notes.length }),
        ...(result.removed.length > 0
          ? [cli.t('prose.build.removed', { count: result.removed.length })]
          : []),
      ]

      emit(cli, {
        action: 'build',
        result: {
          games: state.games.length,
          notes: result.notes.length,
          written: result.written.length,
          removed: result.removed,
          table: result.table,
        },
        events: [],
        prose,
      })
    })
}
