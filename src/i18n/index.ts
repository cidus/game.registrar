/**
 * Localization (docs/spec/00-architecture.md D7).
 *
 * The schema is English; the interface is localized. No user-facing string is
 * written in `src/` — everything goes through `t()`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const FALLBACK_LOCALE = 'en'

type Bundle = Record<string, unknown>

const bundles = new Map<string, Bundle>()

function packageRoot(): string {
  let current = import.meta.dirname
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, 'i18n', `${FALLBACK_LOCALE}.json`))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('i18n directory not found')
}

const i18nDir = resolve(packageRoot(), 'i18n')

export function availableLocales(): string[] {
  return readdirSync(i18nDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort()
}

function loadBundle(locale: string): Bundle {
  const cached = bundles.get(locale)
  if (cached !== undefined) return cached

  const file = join(i18nDir, `${locale}.json`)
  const bundle: Bundle = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Bundle)
    : {}
  bundles.set(locale, bundle)
  return bundle
}

/**
 * `--locale` → config → `GAMEREG_LOCALE` → `LC_ALL`/`LANG` → `en`.
 * An unknown tag degrades to its base language, then to English.
 */
export function resolveLocale(preferred: (string | null | undefined)[]): string {
  const known = availableLocales()
  for (const candidate of preferred) {
    if (candidate === null || candidate === undefined || candidate === '') continue
    const tag = candidate.replace('_', '-').split('.')[0] ?? ''
    if (known.includes(tag)) return tag
    const base = tag.split('-')[0] ?? ''
    const match = known.find((locale) => locale === base || locale.startsWith(`${base}-`))
    if (match !== undefined) return match
  }
  return FALLBACK_LOCALE
}

export function localeFromEnvironment(): string[] {
  return [process.env['GAMEREG_LOCALE'], process.env['LC_ALL'], process.env['LANG']]
    .filter((value): value is string => typeof value === 'string')
}

function lookup(bundle: Bundle, key: string): unknown {
  let current: unknown = bundle
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined || value === null ? whole : String(value)
  })
}

export type Translator = {
  locale: string
  t: (key: string, params?: Record<string, unknown>) => string
  /** Localized display label for a vocabulary token, falling back to the token. */
  label: (vocabulary: string, token: string) => string
  has: (key: string) => boolean
}

export function translator(locale: string): Translator {
  const primary = loadBundle(locale)
  const fallback = loadBundle(FALLBACK_LOCALE)

  const raw = (key: string): string | undefined => {
    const found = lookup(primary, key) ?? lookup(fallback, key)
    return typeof found === 'string' ? found : undefined
  }

  return {
    locale,
    has: (key) => raw(key) !== undefined,
    t: (key, params = {}) => interpolate(raw(key) ?? key, params),
    label: (vocabulary, token) => raw(`vocab.${vocabulary}.${token}`) ?? token,
  }
}

export type CommandAliases = {
  /** Localized command name → canonical English name. */
  commands: Map<string, string>
  /** Localized long flag (`--nota`) → canonical (`--rating`). */
  flags: Map<string, string>
}

/**
 * Aliases from *every* shipped locale, because locale sets the output language,
 * not the accepted input: `gamereg iniciar` works under `--locale en`.
 */
export function allAliases(): CommandAliases {
  const commands = new Map<string, string>()
  const flags = new Map<string, string>()

  for (const locale of availableLocales()) {
    const bundle = loadBundle(locale)
    const commandMap = lookup(bundle, 'cli.commands')
    if (typeof commandMap === 'object' && commandMap !== null) {
      for (const [canonical, alias] of Object.entries(commandMap as Record<string, unknown>)) {
        if (typeof alias === 'string' && alias !== canonical) commands.set(alias, canonical)
      }
    }
    const flagMap = lookup(bundle, 'cli.flags')
    if (typeof flagMap === 'object' && flagMap !== null) {
      for (const [canonical, alias] of Object.entries(flagMap as Record<string, unknown>)) {
        if (typeof alias === 'string' && alias !== canonical) flags.set(alias, canonical)
      }
    }
  }

  return { commands, flags }
}
