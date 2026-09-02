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

import { parseDuration } from './duration.ts'
import { GameregError } from './errors.ts'
import type { PlatformEntry } from './platforms.ts'
import { parseClock } from './time.ts'
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
  /**
   * When the Registrar notices an open session and says something
   * (docs/spec/05-agent.md "Check-ins"). Every value here is a clock or a
   * counter, which is exactly why they live in the CLI and not in a model.
   */
  checkin: CheckinConfig
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

export type CheckinConfig = {
  /**
   * How long a session may stand open before the `duration` trigger fires.
   * `null` switches that trigger off entirely — someone who wants a silent
   * ledger must be able to have one, with the `day_cutoff` chase intact.
   */
  after: string | null
  /** Wall-clock times that fire the `clock` trigger while a session is open. */
  clock: string[]
  /**
   * When the `day_cutoff` chase is *delivered*. `day_cutoff` says when the
   * trigger fires; this says when the question is asked, and the two are
   * different concepts on purpose — asking at the cutoff asks while the
   * session is most likely still running. `null` asks at the cutoff itself.
   */
  chase_at: string | null
  /** The escalating ladder, applied in order after each check-in. */
  backoff: string[]
  /** A hard ceiling on `duration` and `clock` asks. `day_cutoff` is exempt. */
  max_per_session: number
  /** Silence past this long is filed as `no_reply` by `checkin --expire`. */
  reply_window: string
  /**
   * `[from, to]`, `HH:MM`. Suppresses `duration` and `clock` only, and holds
   * rather than drops: a trigger that fires inside the window is delivered
   * when it ends. Empty means no quiet hours at all.
   */
  quiet_hours: string[]
  /** The register the check-in is written in. Read by the agent, never here. */
  persona_prompt: string | null
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
  checkin: {
    after: '4h',
    clock: ['01:00'],
    chase_at: '09:00',
    backoff: ['2h', '3h', '5h'],
    max_per_session: 3,
    reply_window: '45m',
    quiet_hours: ['02:00', '09:00'],
    persona_prompt: null,
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

/**
 * A setting whose *value* is malformed, named by its path.
 *
 * `checkin` is the first block where every value is a parsed one — a duration,
 * a time of day, a counter — so a typo has to be caught here rather than at the
 * moment the trigger would have fired, which is hours later and unattended.
 */
function badValue(key: string, value: unknown, file: string): GameregError {
  return new GameregError('usage', 'error.bad_config_value', {
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
    file,
  })
}

function readDuration(value: unknown, key: string, file: string): string {
  if (typeof value !== 'string') throw badValue(key, value, file)
  try {
    parseDuration(value)
  } catch {
    throw badValue(key, value, file)
  }
  return value
}

function readClock(value: unknown, key: string, file: string): string {
  if (typeof value !== 'string') throw badValue(key, value, file)
  try {
    parseClock(value)
  } catch {
    throw badValue(key, value, file)
  }
  return value
}

function readClockList(value: unknown, key: string, file: string): string[] {
  if (!Array.isArray(value)) throw badValue(key, value, file)
  return value.map((entry, index) => readClock(entry, `${key}[${index}]`, file))
}

/**
 * `checkin`, with every value parsed on the way in (docs/spec/05-agent.md).
 *
 * `after` and `chase_at` accept `null` explicitly rather than by omission:
 * `null` is what switches the `duration` trigger off and what asks the
 * `day_cutoff` chase at the cutoff itself, so reading it as "unset" would
 * silently restore the default and keep asking.
 */
function parseCheckin(source: Record<string, unknown>, into: CheckinConfig, file: string): void {
  if ('after' in source) {
    into.after = source['after'] === null ? null : readDuration(source['after'], 'checkin.after', file)
  }
  if ('clock' in source) into.clock = readClockList(source['clock'], 'checkin.clock', file)
  if ('chase_at' in source) {
    into.chase_at = source['chase_at'] === null ? null : readClock(source['chase_at'], 'checkin.chase_at', file)
  }
  if ('backoff' in source) {
    const value = source['backoff']
    if (!Array.isArray(value)) throw badValue('checkin.backoff', value, file)
    into.backoff = value.map((entry, index) => readDuration(entry, `checkin.backoff[${index}]`, file))
  }
  if ('max_per_session' in source) {
    const value = source['max_per_session']
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw badValue('checkin.max_per_session', value, file)
    }
    into.max_per_session = value
  }
  if ('reply_window' in source) {
    into.reply_window = readDuration(source['reply_window'], 'checkin.reply_window', file)
  }
  if ('quiet_hours' in source) {
    const window = readClockList(source['quiet_hours'], 'checkin.quiet_hours', file)
    // Two times or none. One is a window with no end, and there is no sane
    // reading of it that is not a guess.
    if (window.length !== 0 && window.length !== 2) throw badValue('checkin.quiet_hours', source['quiet_hours'], file)
    into.quiet_hours = window
  }
  if ('persona_prompt' in source) {
    const value = source['persona_prompt']
    if (value !== null && typeof value !== 'string') throw badValue('checkin.persona_prompt', value, file)
    into.persona_prompt = value
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
  if ('day_cutoff' in source) config.day_cutoff = readClock(source['day_cutoff'], 'day_cutoff', file)

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

  const checkin = source['checkin']
  if (typeof checkin === 'object' && checkin !== null && !Array.isArray(checkin)) {
    parseCheckin(checkin as Record<string, unknown>, config.checkin, file)
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
