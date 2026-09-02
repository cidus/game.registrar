/**
 * The platform vocabulary (docs/spec/02-cli.md "Platform vocabulary").
 *
 * Two properties are load-bearing and everything else follows from them: the
 * table canonicalizes but never rejects, and the user's own entry beats the
 * built-in one for the whole group of spellings, not just for the one word
 * they typed.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fold, type GameState } from '../src/core/fold.ts'
import {
  addPlatform,
  canonicalPlatform,
  canonicalPlatforms,
  platformGroups,
  platformKey,
  platformSpellings,
  platformTable,
  platformUsage,
  removePlatform,
  samePlatform,
  soleMatch,
} from '../src/core/platforms.ts'
import { context, event } from './helpers.ts'

test('a synonym resolves to the name, whatever the casing or punctuation', () => {
  const table = platformTable()
  assert.equal(canonicalPlatform('snes', table), 'Super Nintendo')
  assert.equal(canonicalPlatform('SUPER NES', table), 'Super Nintendo')
  assert.equal(canonicalPlatform('Super Nintendo Entertainment System', table), 'Super Nintendo')
  assert.equal(canonicalPlatform('switch', table), 'Nintendo Switch')
  assert.equal(canonicalPlatform('PC (Microsoft Windows)', table), 'PC')
})

test('an unknown platform is accepted verbatim — the table is not a validator', () => {
  const table = platformTable()
  assert.equal(canonicalPlatform('Odyssey 2', table), 'Odyssey 2')
  assert.equal(canonicalPlatform('  a friend’s laptop  ', table), 'a friend’s laptop')
  assert.equal(canonicalPlatform('', table), null)
  assert.equal(canonicalPlatform(null, table), null)
})

test('the user’s own name wins, and claims the whole group of spellings', () => {
  const table = platformTable([{ name: 'Genesis', aliases: [] }])
  // Not just the word they typed: every spelling the built-in table filed
  // under Mega Drive now answers with theirs.
  assert.equal(canonicalPlatform('Genesis', table), 'Genesis')
  assert.equal(canonicalPlatform('Mega Drive', table), 'Genesis')
  assert.equal(canonicalPlatform('megadrive', table), 'Genesis')
  assert.equal(canonicalPlatform('MD', table), 'Genesis')
})

test('a config synonym reaches a name the built-in table never heard of', () => {
  const table = platformTable([{ name: 'O Videogame da Sala', aliases: ['sala', 'tv'] }])
  assert.equal(canonicalPlatform('TV', table), 'O Videogame da Sala')
  assert.equal(canonicalPlatform('sala', table), 'O Videogame da Sala')
})

test('every spelling of a platform comes back, canonical name first', () => {
  const table = platformTable()
  const spellings = platformSpellings('snes', table)
  assert.equal(spellings[0], 'Super Nintendo')
  // The reason this exists: the provider's own spelling has to be in there,
  // or a query narrowed by name (providers/igdb.ts) matches nothing.
  assert.ok(spellings.includes('Super Nintendo Entertainment System'))
  assert.ok(spellings.includes('Super Famicom'))
})

test('the spellings of a renamed platform carry the group, not just the user’s word', () => {
  const table = platformTable([{ name: 'Genesis', aliases: [] }])
  const spellings = platformSpellings('Mega Drive', table)
  assert.equal(spellings[0], 'Genesis')
  assert.ok(spellings.includes('Mega Drive'))
  assert.ok(spellings.includes('Sega Mega Drive/Genesis'))
})

test('Steam Deck is a spelling of PC, in both directions', () => {
  // Deliberate, and it reaches the register, not only the search: no catalog
  // carries the Deck as a platform, so keeping it separate would name a
  // platform nothing could ever be looked up on. A Deck run reads as PC.
  const table = platformTable()
  assert.equal(canonicalPlatform('steam deck', table), 'PC')
  assert.equal(canonicalPlatform('Deck', table), 'PC')
  assert.ok(platformSpellings('Steam Deck', table).includes('PC (Microsoft Windows)'))
})

test('a platform nobody knows is a spelling of itself; nothing is a spelling of nothing', () => {
  const table = platformTable()
  assert.deepEqual(platformSpellings('O Videogame da Sala', table), ['O Videogame da Sala'])
  assert.deepEqual(platformSpellings(undefined, table), [])
  assert.deepEqual(platformSpellings('   ', table), [])
})

test('the catalogs’ own spellings for the Sega consoles are on record', () => {
  // Both were missing, and a name-narrowed query for either returned nothing
  // at all: IGDB writes them with a slash and neither half matched.
  const table = platformTable()
  assert.equal(canonicalPlatform('Sega Mega Drive/Genesis', table), 'Mega Drive')
  assert.equal(canonicalPlatform('Sega Master System/Mark III', table), 'Master System')
})

test('canonicalization is a fixed point: applying it twice changes nothing', () => {
  const table = platformTable([{ name: 'Genesis', aliases: [] }])
  for (const input of ['snes', 'Mega Drive', 'Odyssey 2', 'PS5']) {
    const once = canonicalPlatform(input, table)
    assert.equal(canonicalPlatform(once, table), once)
  }
})

test('two spellings of one platform compare equal', () => {
  const table = platformTable()
  assert.equal(samePlatform('SNES', 'Super Nintendo', table), true)
  assert.equal(samePlatform('PS5', 'PlayStation 5', table), true)
  assert.equal(samePlatform('PS5', 'PS4', table), false)
  assert.equal(samePlatform(null, 'PS5', table), false)
})

test('a list canonicalizes, de-duplicates and keeps its order', () => {
  const table = platformTable()
  assert.deepEqual(canonicalPlatforms(['switch', 'PC', 'Nintendo Switch', null, ''], table), [
    'Nintendo Switch',
    'PC',
  ])
})

test('add is idempotent across names and synonyms alike', () => {
  let entries = addPlatform([], 'Mega Drive', ['Genesis', 'MD'])
  entries = addPlatform(entries, 'Mega Drive', ['Genesis'])
  assert.deepEqual(entries, [{ name: 'Mega Drive', aliases: ['Genesis', 'MD'] }])

  entries = addPlatform(entries, 'Mega Drive', ['Megadrive'])
  assert.deepEqual(entries[0]?.aliases, ['Genesis', 'MD', 'Megadrive'])
})

test('adding a name that already means an existing platform renames it', () => {
  // Never a second entry for one machine — the old name stays on as a synonym,
  // which is the whole of what a rename has to do.
  let entries = addPlatform([], 'Mega Drive', ['Genesis', 'MD'])
  entries = addPlatform(entries, 'Genesis', [])
  assert.deepEqual(entries, [{ name: 'Genesis', aliases: ['Mega Drive', 'MD'] }])
})

test('a re-spelling of the same name is a correction, not a new synonym', () => {
  // "3do" was learned from something typed in a hurry; "3DO" is how it is
  // written. Keeping the first as a synonym of the second would be noise.
  const entries = addPlatform(addPlatform([], '3do', []), '3DO', [])
  assert.deepEqual(entries, [{ name: '3DO', aliases: [] }])
})

test('a name the built-in table knows arrives with its synonyms attached', () => {
  const entries = addPlatform([], 'PlayStation 5', [])
  assert.deepEqual(entries, [{ name: 'PlayStation 5', aliases: ['PS5'] }])
})

test('a name nobody knows is stored exactly as typed, with no synonyms invented', () => {
  assert.deepEqual(addPlatform([], 'Odyssey 2', []), [{ name: 'Odyssey 2', aliases: [] }])
})

test('remove is a no-op when the name is not there, and matches by synonym', () => {
  const entries = addPlatform([], 'Mega Drive', ['Genesis'])
  assert.deepEqual(removePlatform(entries, 'PlayStation 5'), entries)
  assert.deepEqual(removePlatform(entries, 'genesis'), [])
})

function gameWith(platforms: string[], runs: (string | null)[] = []): GameState {
  const events = [
    event('game.create', {
      game_id: 'G1',
      slug: 'a-game',
      title: 'A Game',
      platforms,
      genres: [],
      providers: {},
      aliases: [],
    }),
    ...runs.map((platform, index) =>
      event('run.open', {
        run_id: `R${index}`,
        game_id: 'G1',
        ...(platform === null ? {} : { platform }),
        form: 'digital',
        mode: 'solo',
        started_on: '2026-01-01',
        replay: index > 0,
      }),
    ),
  ]
  return fold(events, context).gamesById.get('G1')!
}

test('the groups are ordered, and nothing is ever filtered out', () => {
  const table = platformTable([
    { name: 'PlayStation 5', aliases: [] },
    { name: 'MiSTer FPGA', aliases: [] },
  ])
  const game = gameWith(['PlayStation 5', 'Nintendo Switch', 'PC'])
  const groups = platformGroups(game, table)

  assert.deepEqual(groups.matching, ['PlayStation 5'])
  assert.deepEqual(groups.catalog, ['Nintendo Switch', 'PC'])
  // An FPGA board intersects with approximately no catalog, and would be
  // retyped forever if the catalog simply replaced the user's own list.
  assert.deepEqual(groups.owned, ['MiSTer FPGA'])
})

test('a game nobody enriched offers what the vault knows, and nothing pretends otherwise', () => {
  const table = platformTable([{ name: 'PC', aliases: [] }, { name: 'PlayStation 5', aliases: [] }])
  const groups = platformGroups(gameWith([]), table)
  assert.deepEqual(groups.matching, [])
  assert.deepEqual(groups.catalog, [])
  assert.deepEqual(groups.owned, ['PC', 'PlayStation 5'])
})

test('an empty intersection leads with the catalog: the answer is a console you do not own', () => {
  const table = platformTable([{ name: 'PlayStation 5', aliases: [] }])
  const groups = platformGroups(gameWith(['Nintendo Switch', 'Wii U']), table)
  assert.deepEqual(groups.matching, [])
  assert.deepEqual(groups.catalog, ['Nintendo Switch', 'Wii U'])
  assert.deepEqual(groups.owned, ['PlayStation 5'])
})

test('within a group, the platform with more runs behind it comes first', () => {
  const table = platformTable([
    { name: 'PC', aliases: [] },
    { name: 'PlayStation 5', aliases: [] },
  ])
  const events = [
    event('game.create', {
      game_id: 'G1',
      slug: 'a-game',
      title: 'A Game',
      platforms: ['PC', 'PlayStation 5'],
      genres: [],
      providers: {},
      aliases: [],
    }),
    ...['PS5', 'PlayStation 5', 'PC'].map((platform, index) =>
      event('run.open', {
        run_id: `R${index}`,
        game_id: 'G1',
        platform,
        form: 'digital',
        mode: 'solo',
        started_on: '2026-01-01',
        replay: index > 0,
      }),
    ),
  ]
  const state = fold(events, context)
  const usage = platformUsage(state, table)
  // Two runs, spelled two ways, count as the same platform.
  assert.equal(usage.get(platformKey('PlayStation 5')), 2)

  const groups = platformGroups(state.gamesById.get('G1')!, table, usage)
  assert.deepEqual(groups.matching, ['PlayStation 5', 'PC'])
})

test('exactly one platform in common resolves; two do not', () => {
  const one = platformTable([{ name: 'PlayStation 5', aliases: [] }])
  const two = platformTable([
    { name: 'PlayStation 5', aliases: [] },
    { name: 'Nintendo Switch', aliases: [] },
  ])
  const game = gameWith(['PlayStation 5', 'Nintendo Switch', 'PC'])

  assert.equal(soleMatch(platformGroups(game, one)), 'PlayStation 5')
  assert.equal(soleMatch(platformGroups(game, two)), null)
  assert.equal(soleMatch(platformGroups(gameWith([]), one)), null)
})
