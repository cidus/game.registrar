#!/usr/bin/env node
/**
 * `gamereg` (docs/spec/02-cli.md).
 *
 * The CLI is the only writer. It never blocks on input: ambiguity is returned,
 * and the interactive menu is a presenter on top of that return value.
 */
import { Command, CommanderError } from 'commander'

import { GameregError } from '../core/errors.ts'
import { version } from '../core/pkg.ts'
import { loadConfig } from '../core/config.ts'
import { localeFromEnvironment, resolveLocale, translator } from '../i18n/index.ts'
import { currentContext } from './context.ts'
import { emitFailure } from './output.ts'
import { canonicalizeFlags, createRegistrar, withGlobals } from './register.ts'
import { registerAlias } from './commands/alias.ts'
import { registerAmend } from './commands/amend.ts'
import { registerBreak } from './commands/break.ts'
import { registerBuild } from './commands/build.ts'
import { registerDoctor } from './commands/doctor.ts'
import { registerDrop } from './commands/drop.ts'
import { registerEnd } from './commands/end.ts'
import { registerFinish } from './commands/finish.ts'
import { registerOpen } from './commands/open.ts'
import { registerPast } from './commands/past.ts'
import { registerSearch } from './commands/search.ts'
import { registerStart } from './commands/start.ts'
import { registerStatus } from './commands/status.ts'
import { registerVerdict } from './commands/verdict.ts'

/**
 * Help text has to be localized before any command runs, so the two flags that
 * can change the language are read straight off argv.
 */
function bootLocale(argv: readonly string[]): string {
  const valueOf = (name: string): string | undefined => {
    const index = argv.indexOf(name)
    if (index !== -1) return argv[index + 1]
    const inline = argv.find((token) => token.startsWith(`${name}=`))
    return inline?.slice(name.length + 1)
  }

  let configured: string | null = null
  try {
    configured = loadConfig(valueOf('--vault') ?? process.env['GAMEREG_VAULT'] ?? process.cwd()).locale
  } catch {
    configured = null
  }
  return resolveLocale([valueOf('--locale'), configured, ...localeFromEnvironment()])
}

export async function run(argv: readonly string[]): Promise<number> {
  const args = canonicalizeFlags(argv)
  const { t } = translator(bootLocale(args))

  const program = new Command()
  program
    .name('gamereg')
    .description(t('cli.description'))
    .version(version(), '-V, --version', t('help.opt.version'))
    .helpOption('-h, --help', t('help.opt.help'))
    // No `help <command>` subcommand: its wording is commander's, not the
    // Registrar's, and it cannot be localized.
    .helpCommand(false)
    .enablePositionalOptions()
    .exitOverride()
  withGlobals(program, t)

  const registrar = createRegistrar(program, t)
  registerStart(registrar)
  registerEnd(registrar)
  registerBreak(registrar)
  registerFinish(registrar)
  registerDrop(registrar)
  registerPast(registrar)
  registerOpen(registrar)
  registerStatus(registrar)
  registerVerdict(registrar)
  registerSearch(registrar)
  registerAlias(registrar)
  registerAmend(registrar)
  registerBuild(registrar)
  registerDoctor(registrar)

  try {
    await program.parseAsync([...args])
    return process.exitCode === undefined ? 0 : Number(process.exitCode)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return 0
      return emitFailure(currentContext(), new GameregError('usage', 'error.usage', { message: error.message }))
    }
    return emitFailure(currentContext(), error)
  }
}

const invoked = process.argv[1] ?? ''
if (invoked.endsWith('main.ts') || invoked.endsWith('main.js') || invoked.endsWith('gamereg')) {
  process.exit(await run(process.argv))
}
