/**
 * The `stats` target and the renderers under it (docs/spec/07-targets.md,
 * docs/spec/04-derived.md "Heatmap and year in review").
 *
 * Two things are worth more than the rest here. A year in review invites
 * reading the clock, and must not: which years exist comes from the log. And
 * the prose half of a review is the user's, so it has to survive every build.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type { EventEnvelope } from '../src/core/events.ts'
import { readEvents } from '../src/core/events.ts'
import { fold, type VaultState } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator, type Translator } from '../src/i18n/index.ts'
import { OBSIDIAN, quartzFlavour } from '../src/render/flavour.ts'
import { heatmapSvg, level, playByDay, yearsPlayed } from '../src/render/heatmap.ts'
import { reviewBlocks, reviewOf, statsBlocks, totalsOf } from '../src/render/review.ts'
import { stats } from '../src/targets/stats.ts'
import type { PlannedFile } from '../src/targets/types.ts'
import { context, event } from './helpers.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function exampleState(): VaultState {
  const vault = openVault(EXAMPLE)
  return fold(readEvents(vault.eventsFile), timeContext(vault))
}

function plan(state: VaultState, locale = 'en'): PlannedFile[] {
  const vault = openVault(EXAMPLE)
  return stats.plan(state, { config: vault.config, bundle: translator(locale) })
}

const bundle = (locale = 'en'): Translator => translator(locale)

/** A log whose only sessions are far in the past, so "now" cannot be mistaken for data. */
function oldLog(): EventEnvelope[] {
  return [
    event('game.create', { game_id: 'G1', slug: 'chrono-trigger', title: 'Chrono Trigger', platforms: ['SNES'] }),
    event('run.open', {
      run_id: 'R1',
      game_id: 'G1',
      platform: 'SNES',
      started_on: '2019-03-01',
      replay: false,
    }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2019-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2019-03-01T23:00:00-03:00' }),
    event('session.open', { session_id: 'S2', run_id: 'R1', at: '2019-03-02T20:00:00-03:00' }),
    event('session.close', { session_id: 'S2', at: '2019-03-02T20:40:00-03:00' }),
  ]
}

test('plans one note per year, one heatmap per year, and the overview', () => {
  const files = plan(exampleState())
  assert.deepEqual(
    files.map((file) => file.path),
    ['obsidian/Stats.md', 'obsidian/reviews/2026.md', 'obsidian/reviews/heatmap-2026.svg'],
  )
  // Both notes are spliced: the prose an agent offers and a user accepts lives
  // outside the markers, and invariant 3 is what keeps it there.
  assert.deepEqual(
    files.map((file) => file.policy),
    ['splice', 'splice', 'replace'],
  )
  for (const file of files.filter((entry) => entry.policy === 'splice')) {
    assert.notEqual(file.parts, undefined, file.path)
  }
})

test('which years exist comes from the log, never from the calendar', () => {
  const state = fold(oldLog(), context)
  assert.deepEqual(yearsPlayed(state), [2019])
  assert.deepEqual(
    plan(state).map((file) => file.path),
    ['obsidian/Stats.md', 'obsidian/reviews/2019.md', 'obsidian/reviews/heatmap-2019.svg'],
  )
})

test('the same state renders the same bytes in any machine timezone', () => {
  const state = fold(oldLog(), context)
  const render = (zone: string): string => {
    const before = process.env['TZ']
    process.env['TZ'] = zone
    try {
      return plan(state)
        .map((file) => `${file.path}\n${String(file.content)}`)
        .join('\n')
    } finally {
      if (before === undefined) delete process.env['TZ']
      else process.env['TZ'] = before
    }
  }
  assert.equal(render('UTC'), render('Pacific/Kiritimati'))
})

test('the heatmap is a whole year of cells, leap day included', () => {
  const empty = new Map()
  const cells = (svg: string): number => svg.match(/<rect /g)?.length ?? 0
  assert.equal(cells(heatmapSvg(2019, empty, bundle())), 365)
  assert.equal(cells(heatmapSvg(2020, empty, bundle())), 366)
})

test('the levels are fixed thresholds, so two years can be read side by side', () => {
  assert.deepEqual(
    [0, 1, 59, 60, 119, 120, 239, 240, 1000].map(level),
    [0, 1, 1, 2, 2, 3, 3, 4, 4],
  )
})

test('a day with a session still open is shaded, not left blank', () => {
  const state = exampleState()
  const days = playByDay(state)
  // Celeste's session in the fixture is open: it has a day but no minutes.
  assert.equal(days.get('2026-07-20')?.minutes, 0)
  assert.equal(days.get('2026-07-20')?.sessions, 1)
  const svg = heatmapSvg(2026, days, bundle())
  assert.match(svg, /<rect class="l1"[^>]*><title>2026-07-20/)
})

test('the SVG carries its own palette, because a file has no document to inherit one from', () => {
  const svg = heatmapSvg(2026, playByDay(exampleState()), bundle())
  assert.match(svg, /<style>/)
  assert.match(svg, /prefers-color-scheme:dark/)
  // The only URL in it is the SVG namespace; nothing is ever fetched.
  assert.doesNotMatch(svg, /(href|src)=/)
})

test('the review is arithmetic over the log, and says so in every number', () => {
  const review = reviewOf(exampleState(), 2026)
  assert.equal(review.sessions, 6)
  assert.equal(review.days_played, 6)
  assert.equal(review.games_played, 4)
  assert.equal(review.runs_finished, 1)
  assert.equal(review.runs_abandoned, 1)
  assert.equal(review.first_session?.day, '2026-05-03')
  assert.equal(review.last_session?.day, '2026-08-15')
  // Most played first, and only games with a session that year.
  assert.equal(review.top_titles[0]?.slug, 'hollow-knight')
  assert.deepEqual(
    review.top_titles.map((entry) => entry.minutes),
    [...review.top_titles.map((entry) => entry.minutes)].sort((left, right) => right - left),
  )
})

test('the flavour decides bare or qualified wikilinks, the vault target passes OBSIDIAN', () => {
  const state = exampleState()
  const bundle = translator('en')

  const vaultTop = reviewBlocks(state, 2026, bundle, OBSIDIAN).find((block) => block.block === 'top')
  assert.match(vaultTop!.content, /\[\[hollow-knight\\\|/)

  const siteTop = reviewBlocks(state, 2026, bundle, quartzFlavour(false)).find((block) => block.block === 'top')
  assert.match(siteTop!.content, /\[\[games\/hollow-knight\\\|/)

  const vaultYears = statsBlocks(state, bundle, OBSIDIAN).find((block) => block.block === 'years')
  assert.match(vaultYears!.content, /\[\[2026\]\]/)

  const siteYears = statsBlocks(state, bundle, quartzFlavour(false)).find((block) => block.block === 'years')
  assert.match(siteYears!.content, /\[\[reviews\/2026\]\]/)
})

test('stated hours belong to the run, not to a day, so they stay out of the year', () => {
  // Chrono Trigger is an import: 30 stated hours, no session, ended in 2011.
  const state = exampleState()
  assert.equal(totalsOf(state).minutes, 2578)
  assert.equal(reviewOf(state, 2026).minutes, 778)
  assert.deepEqual(yearsPlayed(state), [2026])
})

test('the notes are localized, and the data inside them is not', () => {
  const en = plan(exampleState(), 'en')
  const pt = plan(exampleState(), 'pt-BR')
  const review = (files: PlannedFile[]): string => String(files[1]!.content)
  assert.match(review(en), /# 2026 in review/)
  assert.match(review(pt), /# Retrospectiva de 2026/)
  // Dates stay ISO and hours keep their decimal point in both.
  for (const text of [review(en), review(pt)]) assert.match(text, /2026-08-12 \| 9\.0/)
})

test('two plans from the same state are byte-identical', () => {
  const state = exampleState()
  assert.deepEqual(
    plan(state).map((file) => String(file.content)),
    plan(state).map((file) => String(file.content)),
  )
})
