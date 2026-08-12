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
import { checkEnum, FORM, MODE, type Form, type Mode } from './vocab.ts'

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

  return config
}
