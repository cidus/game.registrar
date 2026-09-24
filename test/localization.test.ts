/**
 * Where the localized surface stops and the English schema begins
 * (00-architecture D7, 01-model.md's *Controlled vocabularies*, ADR 0111).
 *
 * The rule is not "notes are translated". It is that a token is localized when
 * it is prose in a cell, and never when something queries it — the Bases view,
 * `gamereg query`, the CSV headers. The two halves are a line apart in the same
 * file, which is exactly why they need a test rather than a convention.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { readEvents } from '../src/core/events.ts'
import { fold, type VaultState } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'

import { availableLocales, translator } from '../src/i18n/index.ts'
import { OBSIDIAN } from '../src/render/flavour.ts'
import { newNote } from '../src/render/note.ts'
import { newRunNote } from '../src/render/run.ts'
import { newTable } from '../src/render/table.ts'
import { obsidian } from '../src/targets/obsidian.ts'
import { quartz } from '../src/targets/quartz.ts'
import { stats } from '../src/targets/stats.ts'
import type { PlannedFile } from '../src/targets/types.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')
const HOLLOW_KNIGHT = '01K5A00000000000000000GAM1'

function exampleState(): VaultState {
  const vault = openVault(EXAMPLE)
  return fold(readEvents(vault.eventsFile), timeContext(vault))
}

function plan(target: { plan: typeof obsidian.plan }, locale: string): PlannedFile[] {
  const vault = openVault(EXAMPLE)
  return target.plan(exampleState(), { config: vault.config, bundle: translator(locale) })
}

test('a criteria cell is a label; the frontmatter beside it is a token', () => {
  const state = exampleState()
  const game = state.gamesById.get(HOLLOW_KNIGHT)!
  const run = game.runs[0]!
  const pt = translator('pt-BR')

  // The body: the same word the column header above it is written in.
  const note = newNote(state, game, pt, OBSIDIAN)
  assert.match(note, /\| final verdadeiro \|/)
  assert.equal(note.includes('| true_ending |'), false)

  // The run note's frontmatter: the token, because the Bases view filters on
  // it and `gamereg query` mirrors it. Translating it would empty a column.
  const runNote = newRunNote(game, run, pt, OBSIDIAN)
  assert.match(runNote, /^completion_criteria: true_ending$/m)
  assert.match(runNote, /^difficulty: hard$/m)
  assert.match(runNote, /^status: finished$/m)
  assert.equal(runNote.includes('final verdadeiro'), false)
  assert.equal(runNote.includes('difícil'), false)
})

test('the consolidated table localizes both enum columns', () => {
  const state = exampleState()
  const pt = newTable(state, translator('pt-BR'), OBSIDIAN)
  assert.match(pt, /\| difícil \| final verdadeiro \|/)

  // English is not a special case — it reads its labels from the bundle too,
  // which is why `true_ending` became `true ending` there.
  const en = newTable(state, translator('en'), OBSIDIAN)
  assert.match(en, /\| hard \| true ending \|/)
  assert.equal(en.includes('true_ending'), false)
})

test('an unknown token falls back to itself rather than disappearing', () => {
  // `label` degrades to the token. A vocabulary gap must not blank a cell.
  const bundle = translator('pt-BR')
  assert.equal(bundle.label('difficulty', 'impossible'), 'impossible')
})

test('the two localized note names move with the locale, and nothing else does', () => {
  const en = plan(obsidian, 'en').map((file) => file.path)
  const pt = plan(obsidian, 'pt-BR').map((file) => file.path)

  assert.equal(en.includes('obsidian/Game List.md'), true)
  assert.equal(pt.includes('obsidian/Lista de Jogos.md'), true)
  assert.equal(pt.includes('obsidian/Game List.md'), false)

  const statsPaths = (locale: string): string[] => plan(stats, locale).map((file) => file.path)
  assert.equal(statsPaths('en').includes('obsidian/Stats.md'), true)
  assert.equal(statsPaths('pt-BR').includes('obsidian/Estatísticas.md'), true)

  // A seed's name never moves: the build never removes a seed, so a localized
  // one would leave the user holding two (ADR 0111).
  for (const locale of ['en', 'pt-BR']) {
    assert.equal(
      plan(obsidian, locale).map((file) => file.path).includes('obsidian/Game Database.base'),
      true,
      locale,
    )
  }

  // And the site tree is locale-independent end to end: its paths are slugs and
  // link targets, which ADR 0052 keeps stable.
  assert.deepEqual(
    plan(quartz, 'pt-BR').map((file) => file.path).sort(),
    plan(quartz, 'en').map((file) => file.path).sort(),
  )
})

test('the note name and the heading inside it are the same string', () => {
  // They were not: the file said `Game List` and the `H1` said `Games`. One
  // key, so a translator cannot move one without the other.
  for (const locale of availableLocales()) {
    const name = translator(locale).t('file.game_list')
    const note = plan(obsidian, locale).find((file) => file.path === `obsidian/${name}.md`)
    assert.notEqual(note, undefined, `${locale}: no note at obsidian/${name}.md`)
    assert.match(String(note?.content), new RegExp(`^# ${name}$`, 'm'))
  }
})

test('a name that becomes a path is a single, legal path component', () => {
  for (const locale of availableLocales()) {
    for (const key of ['file.game_list', 'stats.title']) {
      const value = translator(locale).t(key)
      assert.notEqual(value, '', `${locale} ${key} is empty`)
      assert.equal(/[/\\]/.test(value), false, `${locale} ${key} would become a folder: ${value}`)
      assert.equal(['.', '..'].includes(value), false, `${locale} ${key} is ${value}`)
      // NFC: macOS and Linux disagree about decomposed accents, and the
      // manifest stores the planned string verbatim.
      assert.equal(value, value.normalize('NFC'), `${locale} ${key} is not NFC`)
    }
  }
})

test('the blocks that reach a seed or a filename are defined in every locale', () => {
  // These must not fall back. A missing `site.locale_tag` in pt-BR would seed a
  // Portuguese site with `locale: en-US` — the very bug this change fixes,
  // reintroduced silently through the English fallback.
  const walk = (value: unknown, prefix: string): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, inner]) => walk(inner, `${prefix}.${key}`))
      : [prefix]
  // Straight from the file: `translator` merges English underneath, so a
  // missing key is invisible to `t` — which is the failure being guarded.
  const flatten = (locale: string, block: string): string[] => {
    const file = join(import.meta.dirname, '..', 'i18n', `${locale}.json`)
    const bundle = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    return walk(bundle[block], block).sort()
  }

  for (const block of ['base', 'site', 'file']) {
    const english = flatten('en', block)
    assert.ok(english.length > 0, `en has no ${block} block`)
    for (const locale of availableLocales()) {
      assert.deepEqual(flatten(locale, block), english, `${locale} does not define all of ${block}`)
    }
  }
})
