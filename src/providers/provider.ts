/**
 * The common provider interface (docs/spec/00-architecture.md D5).
 *
 * The core does no network I/O; every provider lives behind this shape and is
 * mocked here in tests, never at the HTTP layer. `search` feeds resolution
 * step 6 (docs/spec/03-resolution.md) and human browsing (`gamereg search`) —
 * relevance-ranked, typo-tolerant, and (for IGDB) truncated to a small page,
 * which is fine for a human scanning a short list. `fetch` feeds
 * `game.enrich` (docs/spec/02-cli.md). `findExact` is a third, narrower
 * thing: every entry whose title is *exactly* `title`, as complete as the
 * provider can make it — used only by `enrich.ts`'s own exact-match
 * threshold, never for display. It exists because relevance search can bury
 * an old, low-engagement release arbitrarily deep — confirmed live: IGDB's
 * `search "Pac-Man"` never surfaces the 1982 Atari 2600 port even at a
 * fetch limit of 50, but an exact `where name = "Pac-Man"` lookup finds it
 * immediately, in a 53-entry result.
 */

/** Same shape as a local `Candidate` (resolve/resolve.ts), plus a cover URL. */
export type ProviderCandidate = {
  id: string
  title: string
  year: number | null
  platforms: string[]
  cover_url: string | null
}

export type ProviderFields = {
  /** The provider's own title — `game.enrich` may use it to correct the stored one. */
  title: string | null
  release_year: number | null
  developer: string | null
  publisher: string | null
  genres: string[]
  platforms: string[]
}

export type ProviderDetail = {
  id: string
  fields: ProviderFields
  cover_url: string | null
}

export type Provider = {
  readonly name: string
  /**
   * `platforms` is every spelling this vault knows for a `--platform` hint
   * (core/platforms.ts `platformSpellings`), never the raw flag. It is a
   * hint about the *query*, not a post-filter: a provider whose API can
   * narrow by platform is expected to do it server-side, because relevance
   * truncation happens before any caller-side filter can run — IGDB's
   * `search "Super Mario"` puts Super Mario World at rank 64 and Super Mario
   * RPG at 103, both far outside the fetched window, so filtering the window
   * afterwards returns neither. A provider that cannot narrow ignores it and
   * the caller filters as before; a narrowed query that comes back empty
   * falls back to the unnarrowed one, so an unknown spelling costs relevance,
   * never every result.
   */
  search(query: string, platforms?: readonly string[]): Promise<ProviderCandidate[]>
  fetch(id: string): Promise<ProviderDetail | null>
  /** Every entry titled exactly `title` — complete, not relevance-truncated. See file comment above. */
  findExact(title: string): Promise<ProviderCandidate[]>
}
