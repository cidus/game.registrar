/**
 * IGDB provider (docs/spec/06-roadmap.md phase 1). Primary metadata source;
 * `rawg.ts` is the fallback.
 *
 * IGDB sits behind Twitch's OAuth2 client-credentials flow: a token is
 * exchanged once per process and reused for every call the command makes,
 * never persisted. `fetchImpl` is injected so tests mock at this module's
 * boundary, never by opening a socket.
 */
import { GameregError } from '../core/errors.ts'
import { PROVIDER_CREDENTIAL_FIELDS, resolveProviderCredentials } from '../core/secrets.ts'
import type { Provider, ProviderCandidate, ProviderDetail, ProviderFields } from './provider.ts'

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const API_URL = 'https://api.igdb.com/v4'

const SEARCH_FIELDS = 'name,first_release_date,platforms.name,cover.url'
const DETAIL_FIELDS =
  'name,first_release_date,platforms.name,cover.url,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher'

type IgdbCompany = { company?: { name?: string }; developer?: boolean; publisher?: boolean }

type IgdbGame = {
  id: number
  name?: string
  first_release_date?: number
  platforms?: { name?: string }[]
  cover?: { url?: string }
  genres?: { name?: string }[]
  involved_companies?: IgdbCompany[]
}

/** IGDB serves protocol-relative, thumbnail-sized URLs by default. */
function coverUrl(cover: IgdbGame['cover']): string | null {
  if (cover?.url === undefined || cover.url === '') return null
  const upgraded = cover.url.replace('t_thumb', 't_cover_big')
  return upgraded.startsWith('//') ? `https:${upgraded}` : upgraded
}

function yearOf(game: IgdbGame): number | null {
  if (game.first_release_date === undefined) return null
  return new Date(game.first_release_date * 1000).getUTCFullYear()
}

function platformsOf(game: IgdbGame): string[] {
  return (game.platforms ?? []).map((platform) => platform.name).filter((name): name is string => Boolean(name))
}

function candidateOf(game: IgdbGame): ProviderCandidate {
  return {
    id: String(game.id),
    title: game.name ?? '',
    year: yearOf(game),
    platforms: platformsOf(game),
    cover_url: coverUrl(game.cover),
  }
}

function fieldsOf(game: IgdbGame): ProviderFields {
  const developer = (game.involved_companies ?? []).find((entry) => entry.developer === true)?.company?.name
  const publisher = (game.involved_companies ?? []).find((entry) => entry.publisher === true)?.company?.name
  return {
    title: game.name ?? null,
    release_year: yearOf(game),
    developer: developer ?? null,
    publisher: publisher ?? null,
    genres: (game.genres ?? []).map((genre) => genre.name).filter((name): name is string => Boolean(name)),
    platforms: platformsOf(game),
  }
}

/** Apicalypse search strings are double-quoted; escape embedded quotes. */
function escapeQuery(query: string): string {
  return query.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function credentialsOf(root: string): { client_id: string; client_secret: string } {
  const credentials = resolveProviderCredentials(root, 'igdb', PROVIDER_CREDENTIAL_FIELDS.igdb)
  if (!credentials.ok) {
    throw new GameregError('provider_unavailable', 'error.provider_credential_missing', {
      provider: 'igdb',
      missing: credentials.missing,
    })
  }
  return credentials.values
}

export function createIgdbProvider(root: string, fetchImpl: typeof fetch = fetch): Provider {
  let token: string | null = null
  let expiresAt = 0

  async function ensureToken(clientId: string, clientSecret: string): Promise<string> {
    if (token !== null && Date.now() < expiresAt) return token

    const url = new URL(TOKEN_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('client_secret', clientSecret)
    url.searchParams.set('grant_type', 'client_credentials')

    let response: Response
    try {
      response = await fetchImpl(url, { method: 'POST' })
    } catch (cause) {
      throw new GameregError('provider_unavailable', 'error.provider_request_failed', { provider: 'igdb' }, { cause })
    }
    if (!response.ok) {
      throw new GameregError('provider_unavailable', 'error.provider_request_failed', {
        provider: 'igdb',
        status: response.status,
      })
    }

    const body = (await response.json()) as { access_token: string; expires_in: number }
    token = body.access_token
    // A minute of slack so a token never expires mid-call.
    expiresAt = Date.now() + Math.max(0, body.expires_in - 60) * 1000
    return token
  }

  async function query(path: string, body: string): Promise<IgdbGame[]> {
    const credentials = credentialsOf(root)
    const accessToken = await ensureToken(credentials.client_id, credentials.client_secret)
    let response: Response
    try {
      response = await fetchImpl(`${API_URL}/${path}`, {
        method: 'POST',
        headers: {
          'Client-ID': credentials.client_id,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain',
        },
        body,
      })
    } catch (cause) {
      throw new GameregError('provider_unavailable', 'error.provider_request_failed', { provider: 'igdb' }, { cause })
    }
    if (!response.ok) {
      throw new GameregError('provider_unavailable', 'error.provider_request_failed', {
        provider: 'igdb',
        status: response.status,
      })
    }
    return (await response.json()) as IgdbGame[]
  }

  return {
    name: 'igdb',

    async search(query_: string): Promise<ProviderCandidate[]> {
      const games = await query('games', `search "${escapeQuery(query_)}"; fields ${SEARCH_FIELDS}; limit 8;`)
      return games.map(candidateOf)
    },

    async fetch(id: string): Promise<ProviderDetail | null> {
      const games = await query('games', `where id = ${id}; fields ${DETAIL_FIELDS};`)
      const game = games[0]
      if (game === undefined) return null
      return { id: String(game.id), fields: fieldsOf(game), cover_url: coverUrl(game.cover) }
    },
  }
}
