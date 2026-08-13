/**
 * Providers, mocked at the fetch boundary (docs/spec/00-architecture.md D5) —
 * never a real socket. `fetchImpl` is injected into both providers for
 * exactly this reason.
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { GameregError } from '../src/core/errors.ts'
import { createIgdbProvider } from '../src/providers/igdb.ts'
import { createRawgProvider } from '../src/providers/rawg.ts'
import { tempDir } from './helpers.ts'

function rootWithSecrets(secrets: Record<string, Record<string, string>>): string {
  const root = tempDir()
  writeFileSync(join(root, 'gamereg.secrets.json'), JSON.stringify(secrets))
  return root
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

test('igdb: search exchanges a token once, then queries games', async () => {
  const root = rootWithSecrets({ igdb: { client_id: 'id', client_secret: 'secret' } })
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('id.twitch.tv')) {
      return jsonResponse({ access_token: 'tok', expires_in: 3600 })
    }
    return jsonResponse([
      {
        id: 7346,
        name: 'Hollow Knight',
        first_release_date: 1489708800,
        platforms: [{ name: 'PC' }],
        cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/abc.jpg' },
      },
    ])
  }) as typeof fetch

  const provider = createIgdbProvider(root, fetchImpl)
  const results = await provider.search('hollow knight')

  assert.equal(calls.length, 2)
  assert.match(calls[0]!.url, /id\.twitch\.tv/)
  assert.match(calls[1]!.url, /api\.igdb\.com\/v4\/games/)
  assert.deepEqual(results, [
    {
      id: '7346',
      title: 'Hollow Knight',
      year: 2017,
      platforms: ['PC'],
      cover_url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg',
    },
  ])
})

test('igdb: findExact queries with a literal `where name =`, not the fuzzy search endpoint', async () => {
  const root = rootWithSecrets({ igdb: { client_id: 'id', client_secret: 'secret' } })
  const bodies: string[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('id.twitch.tv')) return jsonResponse({ access_token: 'tok', expires_in: 3600 })
    bodies.push(String(init?.body ?? ''))
    return jsonResponse([
      { id: 7559, name: 'Pac-Man', first_release_date: 378691200, platforms: [{ name: 'Atari 2600' }] },
    ])
  }) as typeof fetch

  const provider = createIgdbProvider(root, fetchImpl)
  const results = await provider.findExact('Pac-Man')

  assert.equal(bodies.length, 1)
  assert.match(bodies[0]!, /where name = "Pac-Man"/)
  assert.doesNotMatch(bodies[0]!, /^search /)
  assert.deepEqual(results, [
    { id: '7559', title: 'Pac-Man', year: 1982, platforms: ['Atari 2600'], cover_url: null },
  ])
})

test('igdb: findExact escapes embedded quotes the same way search does', async () => {
  const root = rootWithSecrets({ igdb: { client_id: 'id', client_secret: 'secret' } })
  const bodies: string[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('id.twitch.tv')) return jsonResponse({ access_token: 'tok', expires_in: 3600 })
    bodies.push(String(init?.body ?? ''))
    return jsonResponse([])
  }) as typeof fetch

  const provider = createIgdbProvider(root, fetchImpl)
  await provider.findExact('Foo "Bar" Baz')
  assert.match(bodies[0]!, /where name = "Foo \\"Bar\\" Baz"/)
})

test('igdb: reuses the token across a second call in the same provider instance', async () => {
  const root = rootWithSecrets({ igdb: { client_id: 'id', client_secret: 'secret' } })
  let tokenCalls = 0
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).includes('id.twitch.tv')) {
      tokenCalls += 1
      return jsonResponse({ access_token: 'tok', expires_in: 3600 })
    }
    return jsonResponse([])
  }) as typeof fetch

  const provider = createIgdbProvider(root, fetchImpl)
  await provider.search('a')
  await provider.search('b')
  assert.equal(tokenCalls, 1)
})

test('igdb: fetch maps developer, publisher and genres from involved_companies', async () => {
  const root = rootWithSecrets({ igdb: { client_id: 'id', client_secret: 'secret' } })
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).includes('id.twitch.tv')) return jsonResponse({ access_token: 'tok', expires_in: 3600 })
    return jsonResponse([
      {
        id: 7346,
        name: 'Hollow Knight',
        first_release_date: 1489708800,
        platforms: [{ name: 'PC' }, { name: 'Switch' }],
        genres: [{ name: 'Metroidvania' }],
        involved_companies: [
          { company: { name: 'Team Cherry' }, developer: true, publisher: false },
          { company: { name: 'Team Cherry Publishing' }, developer: false, publisher: true },
        ],
      },
    ])
  }) as typeof fetch

  const provider = createIgdbProvider(root, fetchImpl)
  const detail = await provider.fetch('7346')
  assert.deepEqual(detail, {
    id: '7346',
    fields: {
      title: 'Hollow Knight',
      release_year: 2017,
      developer: 'Team Cherry',
      publisher: 'Team Cherry Publishing',
      genres: ['Metroidvania'],
      platforms: ['PC', 'Switch'],
    },
    cover_url: null,
  })
})

test('igdb: fetch returns null when the id does not exist', async () => {
  const root = rootWithSecrets({ igdb: { client_id: 'id', client_secret: 'secret' } })
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).includes('id.twitch.tv')) return jsonResponse({ access_token: 'tok', expires_in: 3600 })
    return jsonResponse([])
  }) as typeof fetch

  const provider = createIgdbProvider(root, fetchImpl)
  assert.equal(await provider.fetch('999999'), null)
})

test('igdb: missing credentials fail with provider_unavailable naming the env var', async () => {
  const root = tempDir()
  const provider = createIgdbProvider(root, (async () => jsonResponse({})) as typeof fetch)
  await assert.rejects(provider.search('zelda'), (error: unknown) => {
    assert.ok(error instanceof GameregError)
    assert.equal(error.code, 6)
    assert.equal(error.params['missing'], 'IGDB_CLIENT_ID')
    return true
  })
})

test('igdb: a non-ok token response fails with provider_unavailable', async () => {
  const root = rootWithSecrets({ igdb: { client_id: 'id', client_secret: 'secret' } })
  const fetchImpl = (async () => jsonResponse({}, false, 401)) as typeof fetch
  const provider = createIgdbProvider(root, fetchImpl)
  await assert.rejects(provider.search('zelda'), (error: unknown) => {
    assert.ok(error instanceof GameregError)
    assert.equal(error.code, 6)
    return true
  })
})

test('rawg: search queries with the api key and maps results', async () => {
  const root = rootWithSecrets({ rawg: { api_key: 'key' } })
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url))
    return jsonResponse({
      results: [
        {
          id: 123,
          name: 'Celeste',
          released: '2018-01-25',
          platforms: [{ platform: { name: 'PC' } }],
          background_image: 'https://example.com/celeste.jpg',
        },
      ],
    })
  }) as typeof fetch

  const provider = createRawgProvider(root, fetchImpl)
  const results = await provider.search('celeste')

  assert.equal(calls.length, 1)
  assert.match(calls[0]!, /api\.rawg\.io\/api\/games\?/)
  assert.match(calls[0]!, /key=key/)
  assert.deepEqual(results, [
    { id: '123', title: 'Celeste', year: 2018, platforms: ['PC'], cover_url: 'https://example.com/celeste.jpg' },
  ])
})

test('rawg: findExact requests the maximum page size, best-effort widening (no confirmed exact filter)', async () => {
  const root = rootWithSecrets({ rawg: { api_key: 'key' } })
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url))
    return jsonResponse({ results: [] })
  }) as typeof fetch

  const provider = createRawgProvider(root, fetchImpl)
  await provider.findExact('Pac-Man')
  assert.match(calls[0]!, /page_size=40/)
  assert.match(calls[0]!, /search=Pac-Man/)
})

test('rawg: fetch maps developers, publishers and genres', async () => {
  const root = rootWithSecrets({ rawg: { api_key: 'key' } })
  const fetchImpl = (async () =>
    jsonResponse({
      id: 123,
      name: 'Celeste',
      released: '2018-01-25',
      platforms: [{ platform: { name: 'PC' } }],
      developers: [{ name: 'Extremely OK Games' }],
      publishers: [{ name: 'Extremely OK Games' }],
      genres: [{ name: 'Platformer' }],
      background_image: 'https://example.com/celeste.jpg',
    })) as typeof fetch

  const provider = createRawgProvider(root, fetchImpl)
  const detail = await provider.fetch('123')
  assert.deepEqual(detail, {
    id: '123',
    fields: {
      title: 'Celeste',
      release_year: 2018,
      developer: 'Extremely OK Games',
      publisher: 'Extremely OK Games',
      genres: ['Platformer'],
      platforms: ['PC'],
    },
    cover_url: 'https://example.com/celeste.jpg',
  })
})

test('rawg: fetch returns null on a 404', async () => {
  const root = rootWithSecrets({ rawg: { api_key: 'key' } })
  const fetchImpl = (async () => jsonResponse({}, false, 404)) as typeof fetch
  const provider = createRawgProvider(root, fetchImpl)
  assert.equal(await provider.fetch('999999'), null)
})

test('rawg: missing credentials fail with provider_unavailable naming the env var', async () => {
  const root = tempDir()
  const provider = createRawgProvider(root, (async () => jsonResponse({})) as typeof fetch)
  await assert.rejects(provider.search('celeste'), (error: unknown) => {
    assert.ok(error instanceof GameregError)
    assert.equal(error.code, 6)
    assert.equal(error.params['missing'], 'RAWG_API_KEY')
    return true
  })
})
