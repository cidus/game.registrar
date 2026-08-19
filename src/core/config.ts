/**
 * `gamereg.config.json` at the vault root. Every key is optional.
 *
 * `defaults` answers a question the specs leave open: `run.open` takes
 * platform, form and mode, and `start` is usually typed without them.
 * Resolution order is flag → last run of that game → config → built-in.
 * Platform has no built-in, and a run that resolves none is recorded without
 * one rather than guessed at (docs/spec/02-cli.md).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { GameregError } from './errors.ts'
import type { PlatformEntry } from './platforms.ts'
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
   * The platforms this vault knows about, with their synonyms. A suggestion
   * list and a spelling table — never a validator (docs/spec/02-cli.md
   * "Platform vocabulary"). Accepts `"PS5"` or
   * `{ "name": "Mega Drive", "aliases": ["Genesis"] }` in the same array.
   */
  platforms: PlatformEntry[]
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
  /** Image ingestion (docs/spec/04-derived.md "Image ingestion"). */
  images: {
    /** Longest side, in pixels, after normalization. */
    max_edge: number
    /** WebP quality, 1–100. */
    quality: number
    /** Store the untouched original alongside the normalized copy. Off by default. */
    keep_original: boolean
    /**
     * Copy attachments (covers included) into the generated site. One switch,
     * not two — see "Decided" in 06-roadmap.md.
     */
    publish: boolean
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
  platforms: [],
  build: {
    // A vault that has never heard of this key still builds notes and the table.
    targets: ['obsidian'],
    csv: { dir: 'data' },
  },
  images: {
    max_edge: 2000,
    quality: 82,
    keep_original: false,
    publish: false,
  },
}

export const CONFIG_FILENAME = 'gamereg.config.json'

/**
 * Rejects a key the config does not define, at any level.
 *
 * The valid names come from `DEFAULT_CONFIG` itself rather than from a list
 * written out here: a second list is a list that drifts from the type it
 * claims to describe, which is the failure this function exists to catch in
 * the first place. `07-targets.md` carried an example with
 * `build.obsidian.run_notes` for four phases; nothing parsed it, nothing said
 * so, and a vault that copied the example got silence and no effect.
 *
 * Unknown *values* have always exited 2 (`checkTarget`, `checkEnum`); unknown
 * *keys* now do the same, and say what is valid at that level.
 *
 * The cost, accepted knowingly: a config written by a newer gamereg breaks an
 * older binary reading the same vault, where before it would have been quietly
 * ignored. One user, one machine and git as sync is the whole deployment, so a
 * loud failure on a key that was going to be ignored anyway is the better half
 * of the trade.
 */
function rejectUnknownKeys(source: Record<string, unknown>, template: unknown, path: string, file: string): void {
  if (typeof template !== 'object' || template === null || Array.isArray(template)) return
  const known = template as Record<string, unknown>

  for (const [key, value] of Object.entries(source)) {
    if (!(key in known)) {
      throw new GameregError('usage', 'error.unknown_config_key', {
        key: path === '' ? key : `${path}.${key}`,
        file,
        valid: Object.keys(known).join(', '),
      })
    }
    // Recurse only into nested objects — `platforms` and `build.targets` are
    // arrays with their own parsers, and a null default (`locale`) describes a
    // scalar, not a shape.
    const nested = known[key]
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof nested === 'object' &&
      nested !== null &&
      !Array.isArray(nested)
    ) {
      rejectUnknownKeys(value as Record<string, unknown>, nested, path === '' ? key : `${path}.${key}`, file)
    }
  }
}

/** `"PS5"` is shorthand for `{ "name": "PS5", "aliases": [] }`; both are legal. */
function parsePlatforms(values: readonly unknown[], file: string): PlatformEntry[] {
  const entries: PlatformEntry[] = []
  for (const value of values) {
    if (typeof value === 'string') {
      if (value.trim() !== '') entries.push({ name: value.trim(), aliases: [] })
      continue
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new GameregError('usage', 'error.bad_config', { file })
    }
    const entry = value as Record<string, unknown>
    const name = entry['name']
    if (typeof name !== 'string' || name.trim() === '') {
      throw new GameregError('usage', 'error.bad_config', { file })
    }
    const aliases = entry['aliases']
    if (aliases !== undefined && !Array.isArray(aliases)) {
      throw new GameregError('usage', 'error.bad_config', { file })
    }
    // A platform entry is `{ name, aliases }` and nothing else. `alias` for
    // `aliases` is the typo this catches, and it used to cost every synonym in
    // the entry with no word said.
    for (const key of Object.keys(entry)) {
      if (key !== 'name' && key !== 'aliases') {
        throw new GameregError('usage', 'error.unknown_config_key', {
          key: `platforms[].${key}`,
          file,
          valid: 'name, aliases',
        })
      }
    }
    entries.push({
      name: name.trim(),
      aliases: (aliases ?? [])
        .filter((alias): alias is string => typeof alias === 'string')
        .map((alias) => alias.trim())
        .filter((alias) => alias !== ''),
    })
  }
  return entries
}

/**
 * The config as it is written back to disk. Only `init` and `platform
 * add|remove` write it, and a platform with no synonyms goes back as the plain
 * string it probably arrived as — the file stays something a human edits.
 */
export function writeConfig(root: string, config: Config): void {
  writeFileSync(join(root, CONFIG_FILENAME), `${JSON.stringify(configToJson(config), null, 2)}\n`, 'utf8')
}

export function configToJson(config: Config): Record<string, unknown> {
  return {
    ...config,
    platforms: config.platforms.map((entry) =>
      entry.aliases.length === 0 ? entry.name : { name: entry.name, aliases: entry.aliases },
    ),
  }
}

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

  rejectUnknownKeys(source, DEFAULT_CONFIG, '', file)

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

  const platforms = source['platforms']
  if (Array.isArray(platforms)) config.platforms = parsePlatforms(platforms, file)

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

  const images = source['images']
  if (typeof images === 'object' && images !== null && !Array.isArray(images)) {
    const entries = images as Record<string, unknown>
    if (typeof entries['max_edge'] === 'number') config.images.max_edge = entries['max_edge']
    if (typeof entries['quality'] === 'number') config.images.quality = entries['quality']
    if (typeof entries['keep_original'] === 'boolean') config.images.keep_original = entries['keep_original']
    if (typeof entries['publish'] === 'boolean') config.images.publish = entries['publish']
  }

  return config
}
