/**
 * `gamereg.config.json` at the vault root. Every key is optional.
 *
 * `defaults` answers a question the specs leave open: `run.open` requires
 * platform, form and mode, and `start` is usually typed without them. Resolution
 * order is flag → last run of that game → config → built-in. Platform has no
 * built-in, because guessing it silently mislabels the record.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { GameregError } from './errors.ts'
import { checkEnum, checkTarget, FORM, MODE, type BuildTarget, type Form, type Mode } from './vocab.ts'

export type Config = {
  locale: string | null
  timezone: string | null
  /** `HH:MM`. When the logical day flips for reporting. */
  day_cutoff: string
  defaults: {
    platform: string | null
    form: Form
    mode: Mode
  }
  /**
   * Which artifacts this vault emits. A property of the vault, never of the last
   * command typed — `gamereg build csv` narrows a build, it does not redefine
   * what the vault contains (docs/spec/07-targets.md).
   */
  build: {
    targets: BuildTarget[]
    csv: {
      /** Vault-relative directory. Empty means the vault root. */
      dir: string
    }
  }
}

export const DEFAULT_CONFIG: Config = {
  locale: null,
  timezone: null,
  day_cutoff: '05:00',
  defaults: {
    platform: null,
    form: 'digital',
    mode: 'solo',
  },
  build: {
    // A vault that has never heard of this key still builds notes and the table.
    targets: ['obsidian'],
    csv: { dir: 'data' },
  },
}

export const CONFIG_FILENAME = 'gamereg.config.json'

export function loadConfig(root: string): Config {
  const file = join(root, CONFIG_FILENAME)
  if (!existsSync(file)) return structuredClone(DEFAULT_CONFIG)

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (cause) {
    throw new GameregError('usage', 'error.bad_config', { file }, { cause })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GameregError('usage', 'error.bad_config', { file })
  }

  const source = parsed as Record<string, unknown>
  const config = structuredClone(DEFAULT_CONFIG)

  if (typeof source['locale'] === 'string') config.locale = source['locale']
  if (typeof source['timezone'] === 'string') config.timezone = source['timezone']
  if (typeof source['day_cutoff'] === 'string') config.day_cutoff = source['day_cutoff']

  const defaults = source['defaults']
  if (typeof defaults === 'object' && defaults !== null && !Array.isArray(defaults)) {
    const entries = defaults as Record<string, unknown>
    if (typeof entries['platform'] === 'string') config.defaults.platform = entries['platform']
    if (typeof entries['form'] === 'string') {
      config.defaults.form = checkEnum('form', entries['form'], FORM)
    }
    if (typeof entries['mode'] === 'string') {
      config.defaults.mode = checkEnum('mode', entries['mode'], MODE)
    }
  }

  const build = source['build']
  if (typeof build === 'object' && build !== null && !Array.isArray(build)) {
    const entries = build as Record<string, unknown>
    const targets = entries['targets']
    if (Array.isArray(targets)) {
      // Validated like any other enum: an unknown name exits 2 listing the
      // valid ones, and a later phase's target exits 2 saying so.
      const named: BuildTarget[] = []
      for (const value of targets) {
        if (typeof value !== 'string') {
          throw new GameregError('usage', 'error.bad_config', { file })
        }
        const name = checkTarget(value)
        if (!named.includes(name)) named.push(name)
      }
      config.build.targets = named
    }

    const csv = entries['csv']
    if (typeof csv === 'object' && csv !== null && !Array.isArray(csv)) {
      const dir = (csv as Record<string, unknown>)['dir']
      // Trailing slashes are the user being tidy, not a path component.
      if (typeof dir === 'string') config.build.csv.dir = dir.replace(/\/+$/, '')
    }
  }

  return config
}
