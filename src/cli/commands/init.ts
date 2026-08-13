/**
 * `gamereg init` — write gamereg.config.json at the vault root.
 *
 * The only file this command writes. Every other path in the vault directory
 * listing (docs/spec/00-architecture.md) is created lazily, by whichever
 * command or target first needs it.
 */
import { checkbox, input, select } from '@inquirer/prompts'
import type { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONFIG_FILENAME, type Config } from '../../core/config.ts'
import { GameregError } from '../../core/errors.ts'
import {
  BUILD_TARGET,
  checkEnum,
  checkTarget,
  CURRENT_PHASE,
  FORM,
  MODE,
  TARGET_PHASE,
  type BuildTarget,
  type Form,
  type Mode,
} from '../../core/vocab.ts'
import type { Cli } from '../context.ts'
import { createContext, mergeGlobals } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'

type Options = {
  timezone?: string
  dayCutoff?: string
  platform?: string
  form?: string
  mode?: string
  targets?: string
  csvDir?: string
}

const CUTOFF_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function checkCutoff(value: string): string {
  if (!CUTOFF_RE.test(value)) throw new GameregError('usage', 'error.bad_cutoff', { value })
  return value
}

function parseTargets(value: string): BuildTarget[] {
  const named: BuildTarget[] = []
  for (const raw of value.split(',').map((token) => token.trim()).filter((token) => token !== '')) {
    const name = checkTarget(raw)
    if (!named.includes(name)) named.push(name)
  }
  return named
}

async function ask(message: string, def: string): Promise<string> {
  try {
    return await input({ message, default: def })
  } catch {
    throw new GameregError('usage', 'prompt.cancelled')
  }
}

async function askOne<T extends string>(message: string, choices: readonly T[], def: T): Promise<T> {
  try {
    return await select<T>({ message, choices: choices.map((value) => ({ name: value, value })), default: def })
  } catch {
    throw new GameregError('usage', 'prompt.cancelled')
  }
}

async function askTargets(message: string, def: readonly BuildTarget[]): Promise<BuildTarget[]> {
  const available = BUILD_TARGET.filter((name) => TARGET_PHASE[name] <= CURRENT_PHASE)
  try {
    return await checkbox<BuildTarget>({
      message,
      choices: available.map((name) => ({ name, value: name, checked: def.includes(name) })),
    })
  } catch {
    throw new GameregError('usage', 'prompt.cancelled')
  }
}

/** Flag, then an interactive prompt seeded with the current value, then that value untouched. */
async function resolveField(
  cli: Cli,
  flag: string | undefined,
  prompt: (() => Promise<string>) | null,
): Promise<string | undefined> {
  if (flag !== undefined) return flag
  if (prompt !== null && cli.interactive) return prompt()
  return undefined
}

export function registerInit(registrar: Registrar): void {
  registrar
    .command('init', 'help.init')
    .option('--timezone <tz>', registrar.t('help.opt.timezone'))
    .option('--day-cutoff <hh:mm>', registrar.t('help.opt.day_cutoff'))
    .option('--platform <platform>', registrar.t('help.opt.platform'))
    .option('--form <form>', registrar.t('help.opt.form'))
    .option('--mode <mode>', registrar.t('help.opt.mode'))
    .option('--targets <list>', registrar.t('help.opt.targets'))
    .option('--csv-dir <dir>', registrar.t('help.opt.csv_dir'))
    .action(async (options: Options, command: Command) => {
      const cli = createContext(command)
      // `--locale` is already a global flag (it also picks this invocation's
      // own output language); init reuses it rather than declaring a second
      // one, but needs the raw value to tell "not passed" from "the default".
      const localeFlag = mergeGlobals(command).locale
      const file = join(cli.vault.root, CONFIG_FILENAME)
      const existing = existsSync(file)

      if (existing && !cli.yes) {
        throw new GameregError('needs_confirmation', 'error.vault_exists', { file })
      }

      // The current effective config — DEFAULT_CONFIG when no file exists yet,
      // the parsed file otherwise — seeds both the flags' fallback and every
      // prompt's default. Re-running `init --yes` interactively is therefore an
      // edit, never a reset.
      const seed = cli.vault.config
      const config: Config = structuredClone(seed)

      const locale = await resolveField(cli, localeFlag, () => ask(cli.t('prompt.init.locale'), seed.locale ?? ''))
      if (locale !== undefined) config.locale = locale.trim() === '' ? null : locale.trim()

      const timezone = await resolveField(cli, options.timezone, () =>
        ask(cli.t('prompt.init.timezone'), seed.timezone ?? ''),
      )
      if (timezone !== undefined) config.timezone = timezone.trim() === '' ? null : timezone.trim()

      const dayCutoff = await resolveField(cli, options.dayCutoff, () => ask(cli.t('prompt.init.day_cutoff'), seed.day_cutoff))
      if (dayCutoff !== undefined) config.day_cutoff = checkCutoff(dayCutoff)

      const platform = await resolveField(cli, options.platform, () =>
        ask(cli.t('prompt.init.platform'), seed.defaults.platform ?? ''),
      )
      if (platform !== undefined) config.defaults.platform = platform.trim() === '' ? null : platform.trim()

      if (options.form !== undefined) {
        config.defaults.form = checkEnum('form', options.form, FORM)
      } else if (cli.interactive) {
        config.defaults.form = await askOne<Form>(cli.t('prompt.init.form'), FORM, seed.defaults.form)
      }

      if (options.mode !== undefined) {
        config.defaults.mode = checkEnum('mode', options.mode, MODE)
      } else if (cli.interactive) {
        config.defaults.mode = await askOne<Mode>(cli.t('prompt.init.mode'), MODE, seed.defaults.mode)
      }

      if (options.targets !== undefined) {
        config.build.targets = parseTargets(options.targets)
      } else if (cli.interactive) {
        config.build.targets = await askTargets(cli.t('prompt.init.targets'), seed.build.targets)
      }

      const csvDir = await resolveField(cli, options.csvDir, () => ask(cli.t('prompt.init.csv_dir'), seed.build.csv.dir))
      if (csvDir !== undefined) config.build.csv.dir = csvDir.replace(/\/+$/, '')

      if (!cli.dryRun) {
        mkdirSync(cli.vault.root, { recursive: true })
        writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
      }

      emit(cli, {
        action: 'init',
        result: { file: CONFIG_FILENAME, root: cli.vault.root, overwritten: existing, config },
        events: [],
        prose: [
          cli.t(existing ? 'prose.init.overwritten' : 'prose.init.done', {
            root: cli.vault.root,
            targets: config.build.targets.join(', '),
          }),
        ],
      })
    })
}
