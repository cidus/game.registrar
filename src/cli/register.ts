/**
 * Command wiring helpers.
 *
 * Localized command names and flags are accepted regardless of the active
 * locale: locale sets the *output* language, not the accepted input
 * (docs/spec/02-cli.md).
 */
import type { Command } from 'commander'

import { allAliases } from '../i18n/index.ts'

export type Registrar = {
  program: Command
  t: (key: string, params?: Record<string, unknown>) => string
  /** A subcommand carrying every localized alias and the global flags. */
  command: (name: string, descriptionKey: string) => Command
}

function reverse(map: Map<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [alias, canonical] of map) {
    out.set(canonical, [...(out.get(canonical) ?? []), alias])
  }
  return out
}

/** Global flags are declared on every command too, so they may follow the verb. */
export function withGlobals(command: Command, t: Registrar['t']): Command {
  return command
    .option('--json', t('help.opt.json'))
    .option('--non-interactive', t('help.opt.non_interactive'))
    .option('--yes', t('help.opt.yes'))
    .option('--vault <path>', t('help.opt.vault'))
    .option('--locale <tag>', t('help.opt.locale'))
    .option('--dry-run', t('help.opt.dry_run'))
    .option('--at <time>', t('help.opt.at'))
    .option('-q, --quiet', t('help.opt.quiet'))
}

export function createRegistrar(program: Command, t: Registrar['t']): Registrar {
  const commandAliases = reverse(allAliases().commands)

  return {
    program,
    t,
    command(name, descriptionKey) {
      const command = program.command(name).description(t(descriptionKey))
      for (const alias of commandAliases.get(name) ?? []) command.alias(alias)
      return withGlobals(command, t)
    },
  }
}

/**
 * Rewrites localized long flags to their canonical spelling before commander
 * sees them. Flags cannot carry aliases the way commands can.
 */
export function canonicalizeFlags(argv: readonly string[]): string[] {
  const { flags } = allAliases()
  return argv.map((token) => {
    if (!token.startsWith('--')) return token
    const equals = token.indexOf('=')
    const name = equals === -1 ? token : token.slice(0, equals)
    const canonical = flags.get(name)
    if (canonical === undefined) return token
    return equals === -1 ? canonical : `${canonical}${token.slice(equals)}`
  })
}
