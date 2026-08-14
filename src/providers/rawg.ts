/**
 * RAWG provider (docs/spec/06-roadmap.md phase 1). Fallback when IGDB is
 * unavailable or a title is not on it. Simple key-in-query-string REST API,
 * no token exchange.
 *
 * As of 2026-08, api.rawg.io appears offline — requests time out, and
 * rawg.io itself does the same. Left in place since a provider with no
 * credential configured already degrades to "unavailable" cleanly (the
 * existing behavior for anyone who never set up RAWG), and removing it
 * outright is a bigger decision than this observation warrants on its own.
 * Not receiving further updates (see 2026-08-14 in `search()`'s IGDB
 * counterpart, `igdb.ts`, which now widens and ranks its raw fetch — that
 * change was deliberately not mirrored here).
 */
import { GameregError } from '../core/errors.ts'
import { PROVIDER_CREDENTIAL_FIELDS, resolveProviderCredentials } from '../core/secrets.ts'
import type { Provider, ProviderCandidate, ProviderDetail, ProviderFields } from './provider.ts'

const API_URL = 'https://api.rawg.io/api'

type RawgPlatformEntry = { platform?: { name?: string } }
type RawgCompany = { name?: string }

type RawgSearchResult = {
  id: number
  name?: string
  released?: string
  platforms?: RawgPlatformEntry[]
  background_image?: string | null
}

type RawgDetail = RawgSearchResult & {
  developers?: RawgCompany[]
  publishers?: RawgCompany[]
  genres?: { name?: string }[]
}

function yearOf(released: string | undefined): number | null {
  if (released === undefined || released === '') return null
  const year = Number.parseInt(released.slice(0, 4), 10)
  return Number.isNaN(year) ? null : year
}

function platformsOf(entries: RawgPlatformEntry[] | undefined): string[] {
  return (entries ?? []).map((entry) => entry.platform?.name).filter((name): name is string => Boolean(name))
}

function candidateOf(result: RawgSearchResult): ProviderCandidate {
  return {
    id: String(result.id),
    title: result.name ?? '',
    year: yearOf(result.released),
    platforms: platformsOf(result.platforms),
    cover_url: result.background_image ?? null,
  }
}

function fieldsOf(result: RawgDetail): ProviderFields {
  return {
    title: result.name ?? null,
    release_year: yearOf(result.released),
    developer: result.developers?.[0]?.name ?? null,
    publisher: result.publishers?.[0]?.name ?? null,
    genres: (result.genres ?? []).map((genre) => genre.name).filter((name): name is string => Boolean(name)),
    platforms: platformsOf(result.platforms),
  }
}

function apiKeyOf(root: string): string {
  const credentials = resolveProviderCredentials(root, 'rawg', PROVIDER_CREDENTIAL_FIELDS.rawg)
  if (!credentials.ok) {
    throw new GameregError('provider_unavailable', 'error.provider_credential_missing', {
      provider: 'rawg',
      missing: credentials.missing,
    })
  }
  return credentials.values.api_key
}

export function createRawgProvider(root: string, fetchImpl: typeof fetch = fetch): Provider {
  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const apiKey = apiKeyOf(root)
    const url = new URL(`${API_URL}${path}`)
    url.searchParams.set('key', apiKey)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    let response: Response
    try {
      response = await fetchImpl(url)
    } catch (cause) {
      throw new GameregError('provider_unavailable', 'error.provider_request_failed', { provider: 'rawg' }, { cause })
    }
    if (!response.ok) {
      throw new GameregError('provider_unavailable', 'error.provider_request_failed', {
        provider: 'rawg',
        status: response.status,
      })
    }
    return (await response.json()) as T
  }

  return {
    name: 'rawg',

    async search(query: string): Promise<ProviderCandidate[]> {
      const body = await get<{ results: RawgSearchResult[] }>('/games', { search: query, page_size: '8' })
      return body.results.map(candidateOf)
    },

    async findExact(title: string): Promise<ProviderCandidate[]> {
      // RAWG has no documented exact-title filter, unlike IGDB's `where
      // name = ...` — this is the same relevance search, just at RAWG's
      // maximum page size (40), a best-effort widening rather than a true
      // exact/complete lookup like IGDB's.
      const body = await get<{ results: RawgSearchResult[] }>('/games', { search: title, page_size: '40' })
      return body.results.map(candidateOf)
    },

    async fetch(id: string): Promise<ProviderDetail | null> {
      let result: RawgDetail
      try {
        result = await get<RawgDetail>(`/games/${id}`, {})
      } catch (error) {
        if (error instanceof GameregError && error.params['status'] === 404) return null
        throw error
      }
      return { id: String(result.id), fields: fieldsOf(result), cover_url: result.background_image ?? null }
    },
  }
}
