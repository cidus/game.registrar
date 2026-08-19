/**
 * `gamereg vocab` — the register's own words, in the active locale. Never
 * writes, never reads the log, never touches the network.
 *
 * It exists for the agent (docs/spec/05-agent.md "Language"). The agent
 * receives JSON, and JSON is deliberately neutral — the Registrar's voice
 * lives in prose the agent never sees — so every word the user reads in chat
 * is one the model chose. Without this command the model has to invent a
 * translation for `true_ending` or for *filed* each time, which it does
 * inconsistently and, for the register's own vocabulary, in English.
 *
 * What it reports is `vocab` and nothing else: words, no sentences. See the
 * doc comment on `vocabulary()` in i18n/index.ts for why that boundary is the
 * whole safety argument.
 */
import type { Command } from 'commander'

import { vocabulary } from '../../i18n/index.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'

export function registerVocab(registrar: Registrar): void {
  registrar.command('vocab', 'help.vocab').action(async (options: unknown, command: Command) => {
    const cli = createContext(command)
    void options

    const groups = vocabulary(cli.locale)
    const prose = Object.entries(groups).map(
      ([group, terms]) => `${group}: ${Object.values(terms).join(', ')}`,
    )

    emit(cli, {
      action: 'vocab',
      result: { locale: cli.locale, vocabulary: groups },
      events: [],
      prose,
    })
  })
}
