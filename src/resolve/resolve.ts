/**
 * Resolution (docs/spec/03-resolution.md).
 *
 * Ambiguity is a return value, not a prompt. There is exactly one
 * implementation of search, ranking and normalization — this one. The
 * interactive menu is a presenter over the array returned here, never a second
 * code path.
 *
 * `resolveLocal` implements steps 1–5 and 7 only — offline and instant, and
 * that never changes: no write command performs network I/O
 * (00-architecture.md invariant 5), so a write command's resolution stops at
 * "not found" rather than reaching a provider. Step 6 (provider search) is
 * implemented in `gamereg search`, which never writes and is free to ask —
 * see `providerCandidatesOf` below and its use in cli/commands/search.ts.
 */
import type { GameState, VaultState } from '../core/fold.ts'
import { platformTable, samePlatform, type PlatformTable } from '../core/platforms.ts'
import type { GameStatus } from '../core/vocab.ts'
import type { ProviderCandidate } from '../providers/provider.ts'
import { normalize } from './normalize.ts'

export const CANDIDATE_LIMIT = 8

export type Candidate = {
  ref: string
  title: string
  year: number | null
  platforms: string[]
  source: 'local' | 'provider'
  in_log: boolean
  status?: GameStatus
  cover_url?: string | null
}

/** A provider's own result, shaped as the same candidate the caller already knows how to render. */
export function candidateFromProvider(provider: string, candidate: ProviderCandidate): Candidate {
  return {
    ref: `${provider}:${candidate.id}`,
    title: candidate.title,
    year: candidate.year,
    platforms: candidate.platforms,
    source: 'provider',
    in_log: false,
    cover_url: candidate.cover_url,
  }
}

export type Resolution =
  | { kind: 'resolved'; game: GameState }
  | { kind: 'ambiguous'; candidates: Candidate[]; truncated: boolean }
  | { kind: 'not_found' }

export type ResolveOptions = {
  /** `--id game:01K…` or `--id igdb:7346`. */
  id?: string | null
  /** `--platform` filters the list; it never resolves it. */
  platform?: string | null
  /**
   * This vault's platform spellings, so `--platform snes` and `--platform
   * "Super Nintendo"` filter identically. Omitted, only the built-in table
   * applies. It changes how well the filter matches, never what it is allowed
   * to conclude (docs/spec/03-resolution.md).
   */
  platforms?: PlatformTable
}

export type Reference =
  | { kind: 'game'; id: string }
  | { kind: 'provider'; provider: string; id: string }

export function parseReference(value: string): Reference | null {
  const index = value.indexOf(':')
  if (index <= 0) return null
  const scheme = value.slice(0, index)
  const id = value.slice(index + 1)
  if (id === '') return null
  return scheme === 'game' ? { kind: 'game', id } : { kind: 'provider', provider: scheme, id }
}

export function referenceOf(game: GameState): string {
  return `game:${game.game_id}`
}

export function findByReference(state: VaultState, value: string): GameState | null {
  const reference = parseReference(value)
  if (reference === null) return null
  if (reference.kind === 'game') return state.gamesById.get(reference.id) ?? null
  return (
    state.games.find(
      (game) => String(game.providers[reference.provider] ?? '') === reference.id,
    ) ?? null
  )
}

export function candidateOf(game: GameState): Candidate {
  return {
    ref: referenceOf(game),
    title: game.title,
    year: game.release_year,
    platforms: [...game.platforms],
    source: 'local',
    in_log: true,
    status: game.status,
    // A user photo (`game.cover.source === 'user'`) has no url, only a
    // sha256 pointing at a local vault asset — no candidate cover for those yet.
    cover_url: game.cover?.url ?? null,
  }
}

/**
 * Whether `--platform` excludes this game.
 *
 * A game with **no** platforms on record is never excluded. The field answers
 * "which platforms does this game exist on", and an empty one means nobody has
 * said yet — a game created with `--no-metadata` and never enriched carries
 * `[]` forever. Reading that as "exists nowhere" made
 * `start "<its exact title>" --platform "<anything>"` return not_found for a
 * game plainly on record, and `start`/`past` resolve with `allowCreate`, so the
 * next step was a *second* record of the same game with the history split
 * between them. In an append-only log that costs a `revoke`, not a delete.
 *
 * Deliberately not consulting `game.runs[].platform`: it would look like better
 * evidence and it reintroduces the same bug one case over — a game with Switch
 * runs and an empty catalog would stop matching `--platform ps5` for the person
 * about to replay it there.
 */
function matchesPlatform(
  game: GameState,
  platform: string | null | undefined,
  table: PlatformTable = platformTable(),
): boolean {
  if (platform === null || platform === undefined || platform === '') return true
  if (game.platforms.length === 0) return true
  return game.platforms.some((value) => samePlatform(value, platform, table))
}

const STATUS_RANK: Record<GameStatus, number> = {
  playing: 0,
  unplayed: 1,
  finished: 2,
  abandoned: 3,
}

/** Local before provider, `playing` before everything, then year descending. */
export function rank(games: readonly GameState[]): GameState[] {
  return [...games].sort((left, right) => {
    const byStatus = STATUS_RANK[left.status] - STATUS_RANK[right.status]
    if (byStatus !== 0) return byStatus
    const byYear = (right.release_year ?? 0) - (left.release_year ?? 0)
    if (byYear !== 0) return byYear
    return left.game_id < right.game_id ? -1 : left.game_id > right.game_id ? 1 : 0
  })
}

function ambiguous(games: readonly GameState[]): Resolution {
  const ranked = rank(games)
  return {
    kind: 'ambiguous',
    candidates: ranked.slice(0, CANDIDATE_LIMIT).map(candidateOf),
    truncated: ranked.length > CANDIDATE_LIMIT,
  }
}

/** Every string a game answers to: its title, its sort title, its aliases. */
function names(game: GameState): string[] {
  const values = [game.title, ...(game.sort_title === null ? [] : [game.sort_title]), ...game.aliases]
  return values.map((value) => normalize(value))
}

export function search(
  state: VaultState,
  query: string,
  platform?: string | null,
  table?: PlatformTable,
): GameState[] {
  const needle = normalize(query)
  if (needle === '') return []
  const pool = state.games.filter((game) => matchesPlatform(game, platform, table))
  return rank(pool.filter((game) => names(game).some((name) => name.includes(needle))))
}

export function resolveLocal(
  state: VaultState,
  query: string | null,
  options: ResolveOptions = {},
): Resolution {
  // 1 — explicit id. No search at all.
  if (options.id !== null && options.id !== undefined && options.id !== '') {
    const game = findByReference(state, options.id)
    return game === null ? { kind: 'not_found' } : { kind: 'resolved', game }
  }

  if (query === null || normalize(query) === '') return { kind: 'not_found' }

  const needle = normalize(query)
  const pool = state.games.filter((game) => matchesPlatform(game, options.platform, options.platforms))

  // 3 — exact alias match.
  const byAlias = pool.filter((game) => game.aliases.some((alias) => normalize(alias) === needle))
  if (byAlias.length === 1) return { kind: 'resolved', game: byAlias[0]! }

  // An exact title is stronger than any substring hit: "Zelda" resolves even
  // when "Zelda II" is also on record.
  const byTitle = pool.filter((game) => names(game).includes(needle))
  if (byTitle.length === 1) return { kind: 'resolved', game: byTitle[0]! }
  if (byTitle.length > 1) return ambiguous(byTitle)
  if (byAlias.length > 1) return ambiguous(byAlias)

  // 4 and 5 — unique local match, or ambiguity.
  const bySubstring = pool.filter((game) => names(game).some((name) => name.includes(needle)))
  if (bySubstring.length === 1) return { kind: 'resolved', game: bySubstring[0]! }
  if (bySubstring.length > 1) return ambiguous(bySubstring)

  // 6 — provider search would happen here. 7 — `--no-metadata` is the caller's move.
  return { kind: 'not_found' }
}
