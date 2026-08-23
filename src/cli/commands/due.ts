/**
 * `gamereg due` — which open sessions are due a check-in right now.
 *
 * Reads and never writes. The entire contract with cron is here: run it on a
 * schedule, act on what comes back, say nothing when the list is empty. The
 * arithmetic lives in `core/due.ts` so every caller behaves identically and
 * cron needs no memory of its own (docs/spec/02-cli.md, 05-agent.md).
 */
import type { Command } from 'commander'

import { due } from '../../core/due.ts'
import { formatHm } from '../../core/duration.ts'
import { createContext } from '../context.ts'
import { clockOf } from '../format.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { load } from '../workspace.ts'

export function registerDue(registrar: Registrar): void {
  registrar.command('due', 'help.due').action(async (options: unknown, command: Command) => {
    const cli = createContext(command)
    const workspace = load(cli)
    void options

    const rows = due(workspace.state, cli.vault.config, cli.at, cli.time)

    const prose =
      rows.length === 0
        ? [cli.t('prose.due.none')]
        : rows.map((row) =>
            cli.t('prose.due.row', {
              title: row.game,
              time: clockOf(cli, row.opened_at),
              duration: formatHm(row.open_for_minutes),
              trigger: cli.t(`prose.due.trigger.${row.trigger}`),
            }),
          )

    emit(cli, { action: 'due', result: { due: rows }, events: [], prose })
  })
}
