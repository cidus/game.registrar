/**
 * The common provider interface (docs/spec/00-architecture.md D5).
 *
 * The core does no network I/O; every provider lives behind this shape and is
 * mocked here in tests, never at the HTTP layer. `search` feeds resolution
 * step 6 (docs/spec/03-resolution.md); `fetch` feeds `game.enrich`
 * (docs/spec/02-cli.md).
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
  search(query: string): Promise<ProviderCandidate[]>
  fetch(id: string): Promise<ProviderDetail | null>
}
