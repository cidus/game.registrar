#!/usr/bin/env node
/**
 * `gamereg` (docs/spec/02-cli.md).
 *
 * The CLI is the only writer. It never blocks on input: ambiguity is returned,
 * and the interactive menu is a presenter on top of that return value.
 */
import { Command, CommanderError, type Argument, type Option } from 'commander'

import { GameregError } from '../core/errors.ts'
import { version } from '../core/pkg.ts'
import { loadConfig } from '../core/config.ts'
import { localeFromEnvironment, localeStrings, resolveLocale, translator } from '../i18n/index.ts'
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
import { registerInit } from './commands/init.ts'
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
  const locale = bootLocale(args)
  const { t } = translator(locale)
  const { commands: localeCommands, flags: localeFlags, arguments: localeArgs } = localeStrings(locale)

  // The active locale's own name for something that is gamereg's own
  // vocabulary (a command, or an argument placeholder) — never a mix of
  // locales, never the canonical English name once a translation exists.
  // Falls back to canonical only when this locale doesn't translate that
  // particular name — including "gamereg" itself, the binary someone
  // actually types, which is never a key here and so is never translated.
  const displayName = (name: string): string => localeCommands[name] ?? name
  const displayArg = (arg: Argument): string => {
    const name = (localeArgs[arg.name()] ?? arg.name()) + (arg.variadic ? '...' : '')
    return arg.required ? `<${name}>` : `[${name}]`
  }

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
    .configureHelp({
      // The command-list line ("Commands:", and break's own nested list).
      // Shows only the active locale's own name — never canonical + alias
      // stacked together, and never an arbitrary other locale's spelling.
      subcommandTerm(cmd) {
        const cmdArgs = cmd.registeredArguments.map(displayArg).join(' ')
        return (
          displayName(cmd.name()) +
          (cmd.options.length ? ' [options]' : '') +
          (cmdArgs ? ` ${cmdArgs}` : '')
        )
      },
      // The "Usage: ..." line at the top of a specific command's own
      // --help — a separate code path from subcommandTerm, including the
      // ancestor chain for nested commands (break start → gamereg break start).
      commandUsage(cmd) {
        const ancestors: string[] = []
        for (let ancestor = cmd.parent; ancestor !== null; ancestor = ancestor.parent) {
          ancestors.unshift(displayName(ancestor.name()))
        }
        const cmdArgs = cmd.registeredArguments.map(displayArg).join(' ')
        return [
          ...ancestors,
          displayName(cmd.name()),
          cmd.options.length ? '[options]' : '',
          cmd.commands.length ? '[command]' : '',
          cmdArgs,
        ]
          .filter((part) => part !== '')
          .join(' ')
      },
      // The flag column. option.flags is the raw string passed to .option(),
      // e.g. "--vault <path>" or "-q, --quiet" — swap the canonical long
      // flag for the active locale's own spelling, in place.
      optionTerm(option: Option) {
        const canonical = option.long
        const localized = canonical === undefined ? undefined : localeFlags[canonical]
        if (canonical === undefined || localized === undefined) return option.flags
        return option.flags.replace(canonical, localized)
      },
      // The bare name in the "Arguments:" section (descriptions there are
      // already translated via help.arg.*; only the term itself was English).
      argumentTerm(argument: Argument) {
        return localeArgs[argument.name()] ?? argument.name()
      },
    })
  withGlobals(program, t)

  const registrar = createRegistrar(program, t)
  registerInit(registrar)
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
