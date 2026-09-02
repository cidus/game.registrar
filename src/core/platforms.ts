/**
 * Platform vocabulary (docs/spec/02-cli.md "Platform vocabulary").
 *
 * `platform` is free text and stays free text: nothing here rejects a value.
 * What this does is *canonicalize* one spelling onto another, so a register
 * kept for years does not end up holding `SNES`, `Super Nintendo` and
 * `supernes` as three different platforms.
 *
 * The names below are **data, not interface text** — "Nintendo 64" is not
 * translated into anything — which is why this table lives here and not in
 * `i18n/`. Only the prompt labels around it are localized.
 *
 * The synonyms deliberately include the spellings the providers use
 * ("Nintendo Switch", "PC (Microsoft Windows)"): that is what lets a run
 * recorded as `switch` match a catalog entry without a table of provider
 * platform ids to keep in sync.
 */
import { normalize } from '../resolve/normalize.ts'
import type { GameState, VaultState } from './fold.ts'

export type PlatformEntry = {
  name: string
  aliases: string[]
}

/** How a recorded platform came to be recorded. Reported in every JSON result. */
export type PlatformSource = 'flag' | 'last_run' | 'config_default' | 'intersection' | 'prompt'

/**
 * Common platforms and their spellings. Never a validator, never exhaustive:
 * a platform absent from it is accepted verbatim and joins `config.platforms`
 * on first use.
 */
export const BUILTIN_PLATFORMS: readonly PlatformEntry[] = [
  // Steam Deck is filed as a spelling of PC, not a platform of its own: no
  // catalog lists it as one (IGDB has no such platform at all), so a register
  // that kept it separate could name it but never look anything up on it. The
  // cost is accepted and is the whole point — a Deck run reads as PC, here and
  // retroactively, because canonicalization runs on read too.
  {
    name: 'PC',
    aliases: [
      'Windows',
      'PC (Microsoft Windows)',
      'Microsoft Windows',
      'Win',
      'Steam',
      'Steam Deck',
      'SteamDeck',
      'Deck',
    ],
  },
  { name: 'macOS', aliases: ['Mac', 'Mac OS', 'OS X', 'Apple Macintosh'] },
  { name: 'Linux', aliases: ['GNU/Linux', 'SteamOS'] },
  { name: 'Nintendo Switch', aliases: ['Switch', 'NSW', 'Switch 1'] },
  { name: 'Nintendo Switch 2', aliases: ['Switch 2', 'NS2'] },
  { name: 'Wii U', aliases: ['WiiU', 'Nintendo Wii U'] },
  { name: 'Wii', aliases: ['Nintendo Wii'] },
  { name: 'Nintendo GameCube', aliases: ['GameCube', 'Game Cube', 'GC', 'NGC'] },
  { name: 'Nintendo 64', aliases: ['N64'] },
  {
    name: 'Super Nintendo',
    aliases: ['SNES', 'Super NES', 'Super Nintendo Entertainment System', 'Super Famicom', 'SFC'],
  },
  {
    name: 'Nintendo Entertainment System',
    aliases: ['NES', 'Famicom', 'Nintendinho', 'Nintendo 8 bits'],
  },
  { name: 'Game Boy', aliases: ['GameBoy', 'GB'] },
  { name: 'Game Boy Color', aliases: ['GameBoy Color', 'GBC'] },
  { name: 'Game Boy Advance', aliases: ['GameBoy Advance', 'GBA'] },
  { name: 'Nintendo DS', aliases: ['NDS', 'DS'] },
  { name: 'Nintendo 3DS', aliases: ['3DS', 'New Nintendo 3DS'] },
  { name: 'PlayStation', aliases: ['PS1', 'PSX', 'PS One', 'PlayStation 1', 'Playstation'] },
  { name: 'PlayStation 2', aliases: ['PS2'] },
  { name: 'PlayStation 3', aliases: ['PS3'] },
  { name: 'PlayStation 4', aliases: ['PS4'] },
  { name: 'PlayStation 5', aliases: ['PS5'] },
  { name: 'PlayStation Portable', aliases: ['PSP'] },
  { name: 'PlayStation Vita', aliases: ['PS Vita', 'Vita', 'PSVita'] },
  { name: 'Xbox', aliases: ['Xbox Classic'] },
  { name: 'Xbox 360', aliases: ['X360'] },
  { name: 'Xbox One', aliases: ['XOne', 'Xbox One S', 'Xbox One X'] },
  {
    name: 'Xbox Series X|S',
    aliases: ['Xbox Series X', 'Xbox Series S', 'Xbox Series X/S', 'Series X', 'XSX'],
  },
  {
    name: 'Mega Drive',
    aliases: ['Genesis', 'Sega Genesis', 'Sega Mega Drive', 'Sega Mega Drive/Genesis', 'Megadrive', 'MD'],
  },
  { name: 'Master System', aliases: ['Sega Master System', 'Sega Master System/Mark III', 'SMS'] },
  { name: 'Sega Saturn', aliases: ['Saturn'] },
  { name: 'Dreamcast', aliases: ['Sega Dreamcast', 'DC'] },
  { name: 'Game Gear', aliases: ['Sega Game Gear', 'GG'] },
  { name: 'Atari 2600', aliases: ['Atari VCS', '2600'] },
  { name: 'MSX', aliases: ['MSX2'] },
  { name: 'Amiga', aliases: ['Commodore Amiga'] },
  { name: 'Android', aliases: [] },
  { name: 'iOS', aliases: ['iPhone', 'iPad', 'iPadOS'] },
  { name: 'Arcade', aliases: ['Fliperama', 'Coin-op'] },
  { name: 'Neo Geo', aliases: ['NeoGeo', 'Neo Geo AES', 'Neo Geo MVS'] },
]

/**
 * A resolved lookup: every known spelling, normalized, pointing at the name it
 * means. Built once per command from the config and the table above.
 */
export type PlatformTable = {
  /** Normalized spelling → canonical name. */
  lookup: Map<string, string>
  /** The names this vault declares, in config order. */
  configured: string[]
  /**
   * Normalized canonical name → every spelling of it, canonical first.
   *
   * `lookup` answers "what does this string mean"; this answers the reverse,
   * "what else is this called" — which is what lets a provider narrow its own
   * query by platform *name* (providers/igdb.ts) instead of by an id table
   * this repository would have to keep in sync. See the file header.
   */
  spellings: Map<string, string[]>
}

/** The comparison key. Same normalization `game.alias` uses, on both sides. */
export const platformKey = (text: string): string => normalize(text)

const keyOf = platformKey

const keysOf = (entry: PlatformEntry): string[] =>
  [entry.name, ...entry.aliases].map(keyOf).filter((key) => key !== '')

/**
 * `config.platforms` first, the built-in table second, verbatim last.
 *
 * The user's own entry always wins, and it wins for the *whole* group: someone
 * who declares `Genesis` claims every spelling the built-in table filed under
 * `Mega Drive`, rather than ending up with two half-platforms.
 */
export function platformTable(configured: readonly PlatformEntry[] = []): PlatformTable {
  const lookup = new Map<string, string>()
  const spellings = new Map<string, string[]>()
  const names: string[] = []
  const claimed = new Set<string>()

  /** Words in, de-duplicated by normalization, first spelling of each key wins. */
  const collect = (words: readonly string[]): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const word of words) {
      const key = keyOf(word)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      out.push(word)
    }
    return out
  }

  for (const entry of configured) {
    const words = collect([entry.name, ...entry.aliases])
    if (words.length === 0) continue
    const keys = new Set(words.map(keyOf))
    for (const builtin of BUILTIN_PLATFORMS) {
      const builtinKeys = keysOf(builtin)
      if (builtinKeys.some((key) => keys.has(key))) {
        for (const word of [builtin.name, ...builtin.aliases]) {
          const key = keyOf(word)
          if (key === '' || keys.has(key)) continue
          keys.add(key)
          words.push(word)
        }
      }
    }
    for (const key of keys) {
      lookup.set(key, entry.name)
      claimed.add(key)
    }
    spellings.set(keyOf(entry.name), words)
    names.push(entry.name)
  }

  for (const builtin of BUILTIN_PLATFORMS) {
    const keys = keysOf(builtin)
    if (keys.some((key) => claimed.has(key))) continue
    for (const key of keys) lookup.set(key, builtin.name)
    spellings.set(keyOf(builtin.name), collect([builtin.name, ...builtin.aliases]))
  }

  return { lookup, configured: names, spellings }
}

/**
 * The spelling this vault files a platform under. An unknown one is returned
 * as typed — trimmed, never rejected, never renamed.
 */
export function canonicalPlatform(input: string | null | undefined, table: PlatformTable): string | null {
  if (input === null || input === undefined) return null
  const text = input.trim()
  if (text === '') return null
  return table.lookup.get(keyOf(text)) ?? text
}

/**
 * Every spelling this vault knows for one platform, canonical name first.
 *
 * A platform the table has never heard of answers with itself: the user's own
 * word is always a spelling of it. Empty input answers with nothing, so a
 * caller can treat "no hint" and "unknown hint" differently — the first means
 * do not narrow, the second means narrow by the one word we were given.
 */
export function platformSpellings(input: string | null | undefined, table: PlatformTable): string[] {
  const name = canonicalPlatform(input, table)
  if (name === null) return []
  return table.spellings.get(keyOf(name)) ?? [name]
}

/** Whether two spellings mean the same platform under this vault's table. */
export function samePlatform(left: string | null, right: string | null, table: PlatformTable): boolean {
  if (left === null || right === null) return false
  const a = canonicalPlatform(left, table)
  const b = canonicalPlatform(right, table)
  return a !== null && b !== null && keyOf(a) === keyOf(b)
}

/** Canonicalized, de-duplicated, original order kept. */
export function canonicalPlatforms(
  values: readonly (string | null)[],
  table: PlatformTable,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const name = canonicalPlatform(value, table)
    if (name === null) continue
    const key = keyOf(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Merge a name and its synonyms into a list, dedup by normalization across
 * names *and* synonyms — that is what makes `gamereg platform add` idempotent
 * instead of a way to end up with two entries for one machine.
 *
 * It is also the rename: a name that already *means* an existing platform
 * takes over as that entry's name, and the name it replaces stays on as a
 * synonym. Someone who calls it Genesis says so once, and every spelling the
 * table filed under Mega Drive answers with theirs from then on.
 */
export function addPlatform(
  entries: readonly PlatformEntry[],
  name: string,
  aliases: readonly string[],
): PlatformEntry[] {
  const trimmed = name.trim()
  if (trimmed === '') return [...entries]

  const extra = aliases.map((alias) => alias.trim()).filter((alias) => alias !== '')

  const out = entries.map((entry) => ({ name: entry.name, aliases: [...entry.aliases] }))
  const existing = out.find((entry) => keysOf(entry).includes(keyOf(trimmed)))
  const target = existing ?? { name: trimmed, aliases: [] }
  if (existing === undefined) out.push(target)

  if (existing !== undefined && existing.name !== trimmed) {
    const replaced = existing.name
    existing.name = trimmed
    // A different spelling of the same word is a correction, not a synonym
    // worth keeping ("3do" → "3DO"); a different word is the old name, and
    // has to keep resolving.
    existing.aliases = existing.aliases.filter((alias) => keyOf(alias) !== keyOf(trimmed))
    if (keyOf(replaced) !== keyOf(trimmed)) existing.aliases.unshift(replaced)
  }

  // A *new* name the built-in table knows arrives with its synonyms already
  // attached. An entry that is already there keeps the shape the user gave it:
  // re-adding one of its own spellings is a no-op, not a merge.
  const builtin =
    existing === undefined && extra.length === 0
      ? BUILTIN_PLATFORMS.find((entry) => keysOf(entry).includes(keyOf(trimmed)))
      : undefined
  const wanted = builtin === undefined ? extra : [...builtin.aliases]

  for (const alias of wanted) {
    const key = keyOf(alias)
    if (key === keyOf(target.name)) continue
    if (target.aliases.some((known) => keyOf(known) === key)) continue
    target.aliases.push(alias)
  }
  return out
}

/** A no-op when the name isn't there: it only edits a suggestion list. */
export function removePlatform(entries: readonly PlatformEntry[], name: string): PlatformEntry[] {
  const key = keyOf(name.trim())
  if (key === '') return [...entries]
  return entries.filter((entry) => !keysOf(entry).includes(key))
}

/** How many runs are already recorded on each platform, keyed normalized. */
export function platformUsage(state: VaultState, table: PlatformTable): Map<string, number> {
  const counts = new Map<string, number>()
  for (const run of state.runsById.values()) {
    const name = canonicalPlatform(run.platform, table)
    if (name === null) continue
    const key = keyOf(name)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * What to offer, in the order to offer it (docs/spec/02-cli.md "What gets
 * offered, and when nothing is asked"). **Nothing is ever filtered out** — the
 * grouping is the whole mechanism, and it is what keeps a console the user
 * does not own, or one the catalog has never heard of, one keystroke away
 * instead of forbidden.
 */
export type PlatformGroups = {
  /** The catalog and this vault agree. The likely answer. */
  matching: string[]
  /** The rest of the catalog — a console that isn't yours. */
  catalog: string[]
  /** The rest of this vault's — an emulator, a fan port, a handheld nobody catalogs. */
  owned: string[]
}

export function platformGroups(
  game: GameState,
  table: PlatformTable,
  /** Run counts from `platformUsage()`. Omitted, the groups fall back to alphabetical. */
  usage: ReadonlyMap<string, number> = new Map(),
): PlatformGroups {
  const byUse = (left: string, right: string): number => {
    const difference = (usage.get(keyOf(right)) ?? 0) - (usage.get(keyOf(left)) ?? 0)
    return difference !== 0 ? difference : left.localeCompare(right)
  }

  const owned = canonicalPlatforms(table.configured, table)
  const ownedKeys = new Set(owned.map(keyOf))
  const catalog = canonicalPlatforms(game.platforms, table)
  const catalogKeys = new Set(catalog.map(keyOf))

  return {
    matching: catalog.filter((name) => ownedKeys.has(keyOf(name))).sort(byUse),
    catalog: catalog.filter((name) => !ownedKeys.has(keyOf(name))).sort(byUse),
    owned: owned.filter((name) => !catalogKeys.has(keyOf(name))).sort(byUse),
  }
}

/**
 * The one case that needs no question: the catalog and this vault agree on
 * exactly one platform. Still an inference from ownership — the cousin's
 * console is real — so every caller reports it as `intersection` rather than
 * passing it off as something the user said.
 */
export function soleMatch(groups: PlatformGroups): string | null {
  return groups.matching.length === 1 ? (groups.matching[0] ?? null) : null
}
