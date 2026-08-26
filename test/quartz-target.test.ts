/**
 * The `quartz` target and the two rendering flavours under it
 * (docs/spec/07-targets.md's `quartz` section, docs/spec/04-derived.md's
 * *Site*).
 *
 * Three things are worth more than the rest here. The target must stay an
 * ordinary one — it plans from the folded state and never reads what another
 * target wrote, which is non-negotiable 8. The Obsidian flavour must not move
 * by a byte, which `example-vault/`'s golden files prove and one assertion
 * here states directly. And an embed must not claim a picture the site does
 * not carry, which is what `images.publish` decides.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { appendEvents, readEvents } from '../src/core/events.ts'
import { fold, type VaultState } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { OBSIDIAN, quartzFlavour } from '../src/render/flavour.ts'
import { frontmatter, newNote } from '../src/render/note.ts'
import { build } from '../src/targets/build.ts'
import { quartz } from '../src/targets/quartz.ts'
import { template } from '../src/targets/templates.ts'
import type { PlannedFile } from '../src/targets/types.ts'
import { event, tempDir } from './helpers.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function exampleState(): VaultState {
  const vault = openVault(EXAMPLE)
  return fold(readEvents(vault.eventsFile), timeContext(vault))
}

function plan(publish = false): PlannedFile[] {
  const vault = openVault(EXAMPLE)
  const config = { ...vault.config, images: { ...vault.config.images, publish } }
  return quartz.plan(exampleState(), { config, bundle: translator('en') })
}

const text = (files: PlannedFile[], path: string): string => {
  const found = files.find((file) => file.path === path)
  assert.notEqual(found, undefined, `${path} was not planned`)
  return String(found?.content)
}

test('plans a content tree and a seeded config, and no base', () => {
  const files = plan()
  const paths = files.map((file) => file.path)

  assert.equal(paths.includes('quartz/content/index.md'), true)
  assert.equal(paths.includes('quartz/content/games/hollow-knight.md'), true)
  assert.equal(paths.includes('quartz/content/runs/2026-05-03-hollow-knight.md'), true)

  // Every note is written whole: the site carries what the log knows, and the
  // prose a game note holds outside its markers never reaches folded state.
  for (const file of files.filter((entry) => entry.path.endsWith('.md'))) {
    assert.equal(file.policy, 'replace', file.path)
  }

  // The doubled name is Quartz's own convention. Seeded, so it is the user's
  // the moment they touch it.
  const config = files.find((file) => file.path === 'quartz/quartz.config.yaml')
  assert.equal(config?.policy, 'seed')
  assert.match(String(config?.content), /^configuration:/m)
})

test('plans a Stats page and a review note per year, both replaced whole', () => {
  const files = plan()
  const paths = files.map((file) => file.path)

  assert.equal(paths.includes('quartz/content/stats.md'), true)
  assert.equal(paths.includes('quartz/content/reviews/2026.md'), true)
  assert.equal(paths.includes('quartz/content/reviews/heatmap-2026.svg'), true)

  for (const path of ['quartz/content/stats.md', 'quartz/content/reviews/2026.md', 'quartz/content/reviews/heatmap-2026.svg']) {
    const found = files.find((file) => file.path === path)
    assert.equal(found?.policy, 'replace', path)
  }

  // The year-row and the game links are qualified, the same as everywhere
  // else on the site — this is the one thing render/review.ts used to hardcode
  // as a bare Obsidian wikilink.
  assert.match(text(files, 'quartz/content/stats.md'), /\[\[reviews\/2026\]\]/)
  assert.match(text(files, 'quartz/content/reviews/2026.md'), /\[\[games\/hollow-knight\\\|/)
})

test('seeds the same Game Database.base the vault gets, for @quartz-community/bases-page', () => {
  const files = plan()
  const base = files.find((file) => file.path === 'quartz/content/Game Database.base')
  assert.equal(base?.policy, 'seed')
  // Reused verbatim: every property and filter it references — tags, status,
  // platform, genres — is already written the same way in both flavours, so
  // there is no quartz-specific fork of this file.
  assert.equal(base?.content, template('Game Database.base'))
})

test('nothing the target plans lives outside quartz/', () => {
  for (const file of plan()) assert.match(file.path, /^quartz\//, file.path)
})

test('the site frontmatter carries description and draft, and the vault flavour carries neither', () => {
  const state = exampleState()
  const game = state.gamesById.get('01K5A00000000000000000GAM1')
  assert.notEqual(game, undefined)
  const bundle = translator('en')

  const site = frontmatter(game!, quartzFlavour(false), bundle)
  assert.match(site, /^description: /m)
  assert.match(site, /^draft: false$/m)

  const vault = frontmatter(game!, OBSIDIAN, bundle)
  assert.equal(/^description: /m.test(vault), false)
  assert.equal(/^draft:/m.test(vault), false)
})

test('a site wikilink names the folder; the vault one relies on shortest match', () => {
  const files = plan()
  const note = text(files, 'quartz/content/runs/2026-05-03-hollow-knight.md')
  assert.match(note, /\[\[games\/hollow-knight\|Hollow Knight\]\]/)
  assert.match(text(files, 'quartz/content/index.md'), /\[\[games\/hollow-knight\\\|/)
  assert.match(text(files, 'quartz/content/games/hollow-knight.md'), /\[\[runs\/2026-05-03-hollow-knight\\\|/)

  const bundle = translator('en')
  const state = exampleState()
  const game = state.gamesById.get('01K5A00000000000000000GAM1')!
  assert.match(newNote(state, game, bundle, OBSIDIAN), /\[\[2026-05-03-hollow-knight\\\|/)
})

test('the index leads with frontmatter rather than a heading, so Quartz does not title it twice', () => {
  const index = text(plan(), 'quartz/content/index.md')
  assert.match(index, /^---\ntitle: /)
  assert.equal(index.includes('\n# '), false)
})

test('a game note on the site has no empty heading waiting for prose', () => {
  const note = text(plan(), 'quartz/content/games/hollow-knight.md')
  assert.equal(note.includes('## Notes'), false)
  // The vault's own note does, and that is the half the site never sees.
  const state = exampleState()
  const game = state.gamesById.get('01K5A00000000000000000GAM1')!
  assert.match(newNote(state, game, translator('en'), OBSIDIAN), /## Notes\n$/)
})

test('an embed is planned only when images.publish puts the file in the content tree', () => {
  const withheld = text(plan(false), 'quartz/content/games/hollow-knight.md')
  assert.equal(withheld.includes('![[assets/'), false)
  assert.match(withheld, /\*image not published\*/)

  const published = text(plan(true), 'quartz/content/games/hollow-knight.md')
  assert.match(published, /!\[\[assets\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp\]\]/)
  assert.equal(published.includes('image not published'), false)

  // The run note's `cover` property follows the same rule — a property
  // pointing at a file the tree does not hold is worse than no property.
  const runPath = 'quartz/content/runs/2026-05-03-hollow-knight.md'
  assert.equal(text(plan(false), runPath).includes('cover:'), false)
  assert.match(text(plan(true), runPath), /^cover: /m)
})

/** A vault with one game, one run and one ingested cover. */
function scratchVault(publish: boolean): string {
  const root = join(tempDir('gamereg-quartz-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({
      locale: 'en',
      timezone: 'America/Sao_Paulo',
      images: { publish },
      build: { targets: ['quartz'] },
    }),
  )
  const sha = 'a'.repeat(64)
  mkdirSync(join(root, 'assets', sha.slice(0, 2)), { recursive: true })
  writeFileSync(join(root, 'assets', sha.slice(0, 2), `${sha}.webp`), 'not really a webp')
  appendEvents(join(root, 'data', 'events.jsonl'), [
    event('game.create', {
      game_id: 'G1',
      slug: 'tunic',
      title: 'Tunic',
      genres: [],
      platforms: [],
      providers: {},
      aliases: [],
    }),
    event('game.cover', { game_id: 'G1', sha256: sha, source: 'user' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2026-08-15', replay: false }),
  ])
  return root
}

function rebuild(root: string, force = false): ReturnType<typeof build> {
  const vault = openVault(root)
  const state = fold(readEvents(vault.eventsFile), timeContext(vault))
  return build(vault, state, translator('en'), force ? { force: true } : {})
}

test('publishing mirrors the asset files into the content tree, and withholding does not', () => {
  const sha = 'a'.repeat(64)
  const mirrored = (root: string): string =>
    join(root, 'quartz', 'content', 'assets', sha.slice(0, 2), `${sha}.webp`)

  const off = scratchVault(false)
  rebuild(off)
  assert.equal(existsSync(mirrored(off)), false)

  const on = scratchVault(true)
  rebuild(on)
  assert.equal(existsSync(mirrored(on)), true)
  // Add-only and idempotent: a second build touches nothing.
  const before = readFileSync(mirrored(on))
  rebuild(on)
  assert.equal(Buffer.compare(readFileSync(mirrored(on)), before), 0)
})

test('the seeded config survives a build and yields to --force', () => {
  const root = scratchVault(false)
  rebuild(root)
  const config = join(root, 'quartz', 'quartz.config.yaml')
  writeFileSync(config, 'configuration:\n  pageTitle: Mine\n')

  rebuild(root)
  assert.equal(readFileSync(config, 'utf8'), 'configuration:\n  pageTitle: Mine\n')

  rebuild(root, true)
  assert.notEqual(readFileSync(config, 'utf8'), 'configuration:\n  pageTitle: Mine\n')
})

test('disabling the target removes its content and leaves the seeded config alone', () => {
  const root = scratchVault(false)
  rebuild(root)
  const note = join(root, 'quartz', 'content', 'games', 'tunic.md')
  assert.equal(existsSync(note), true)

  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', build: { targets: ['obsidian'] } }),
  )
  rebuild(root)

  assert.equal(existsSync(note), false)
  // A seed is never removed. Once it exists it is the user's.
  assert.equal(existsSync(join(root, 'quartz', 'quartz.config.yaml')), true)
})
