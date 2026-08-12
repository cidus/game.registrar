/**
 * Runtime context for one invocation (docs/spec/02-cli.md "Two independent axes").
 *
 * Output format and interactivity are decided separately, both from the
 * environment, so a human in a terminal gets menus and an agent behind a pipe
 * gets JSON — and neither has to pass a flag.
 */
import type { Command } from 'commander'
import type { DateTime } from 'luxon'

import { openVault, timeContext, type Vault } from '../core/vault.ts'
import { nowIn, parseAt, type TimeContext } from '../core/time.ts'
import { localeFromEnvironment, resolveLocale, translator, type Translator } from '../i18n/index.ts'
import type { EventSource } from '../core/vocab.ts'

export type GlobalOptions = {
  json?: boolean
  nonInteractive?: boolean
  yes?: boolean
  vault?: string
  locale?: string
  dryRun?: boolean
  at?: string
  quiet?: boolean
}

export type Cli = {
  vault: Vault
  time: TimeContext
  now: DateTime
  /** The semantic instant for this invocation: `--at`, or now. */
  at: DateTime
  /** True when `--at` was given, which suppresses "now" phrasing. */
  atGiven: boolean
  json: boolean
  interactive: boolean
  quiet: boolean
  dryRun: boolean
  yes: boolean
  source: EventSource
  t: Translator['t']
  label: Translator['label']
  locale: string
}

/** Program-level flags plus command-level ones, the latter winning when present. */
export function mergeGlobals(command: Command): GlobalOptions {
  const merged: Record<string, unknown> = {}
  const chain: Command[] = []
  for (let current: Command | null = command; current !== null; current = current.parent) {
    chain.unshift(current)
  }
  for (const level of chain) {
    for (const [key, value] of Object.entries(level.opts())) {
      if (value !== undefined) merged[key] = value
    }
  }
  return merged as GlobalOptions
}

const truthy = (value: string | undefined): boolean => value !== undefined && value !== '' && value !== '0'

/**
 * Prompting is allowed only when stdin and stdout are both TTYs, no flag or
 * environment variable forbids it, and output is not JSON.
 */
export function isInteractive(options: GlobalOptions): boolean {
  if (options.json === true) return false
  if (options.nonInteractive === true) return false
  if (truthy(process.env['GAMEREG_NON_INTERACTIVE'])) return false
  if (truthy(process.env['CI'])) return false
  return process.stdin.isTTY === true && process.stdout.isTTY === true
}

/** JSON when stdout is not a TTY, or when `--json` is passed. */
export function isJson(options: GlobalOptions): boolean {
  return options.json === true || process.stdout.isTTY !== true
}

let latest: Cli | null = null

/** The context of the running command, for reporting an error in its locale. */
export function currentContext(): Cli | null {
  return latest
}

export function createContext(command: Command): Cli {
  const options = mergeGlobals(command)
  const vault = openVault(options.vault)
  const time = timeContext(vault)
  const now = nowIn(time)
  const locale = resolveLocale([options.locale, vault.config.locale, ...localeFromEnvironment()])
  const bundle = translator(locale)

  latest = {
    vault,
    time,
    now,
    at: options.at === undefined ? now : parseAt(options.at, { ...time, now }),
    atGiven: options.at !== undefined,
    json: isJson(options),
    interactive: isInteractive(options),
    quiet: options.quiet === true,
    dryRun: options.dryRun === true,
    yes: options.yes === true,
    source: (process.env['GAMEREG_SOURCE'] as EventSource | undefined) ?? 'cli',
    t: bundle.t,
    label: bundle.label,
    locale,
  }
  return latest
}
