/**
 * The diary (docs/spec/04-derived.md "Diary"), `src/render/diary.ts` and its
 * wiring into `src/targets/quartz.ts`.
 *
 * `example-vault/quartz/content/diary/2026.md` is the golden file exercising
 * the ordinary shape (`test/golden.test.ts`); the cases here are the ones a
 * golden file would need contrivance to hold: a photo with no note, a verdict
 * tied with a session on the same day, a run that crosses New Year's, and
 * ownership when the target is disabled.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { DEFAULT_CONFIG, type Config } from '../src/core/config.ts'
import { appendEvents, readEvents, type EventEnvelope } from '../src/core/events.ts'
import { fold } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { build } from '../src/targets/build.ts'
import { quartz } from '../src/targets/quartz.ts'
import type { PlannedFile } from '../src/targets/types.ts'
import { context, event, tempDir } from './helpers.ts'

function plan(events: EventEnvelope[], publish = false): PlannedFile[] {
  const config: Config = {
    ...DEFAULT_CONFIG,
    build: { ...DEFAULT_CONFIG.build, targets: ['quartz'] },
    images: { ...DEFAULT_CONFIG.images, publish },
  }
  return quartz.plan(fold(events, context), { config, bundle: translator('en') })
}

/** A photo whose hash is one repeated character, so the folder is readable. */
const photo = (char: string): Record<string, unknown> => ({
  sha256: char.repeat(64),
  ext: 'webp',
  caption: null,
  captured_at: null,
  kind: 'screenshot',
})

const text = (files: PlannedFile[], path: string): string => {
  const found = files.find((file) => file.path === path)
  assert.notEqual(found, undefined, `${path} was not planned`)
  return String(found?.content)
}

test('a session with an attachment and no note still produces an entry', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', {
      session_id: 'S1',
      at: '2025-03-01T21:00:00-03:00',
      attachments: [{ sha256: 'a'.repeat(64), ext: 'webp', caption: null, captured_at: null, kind: 'screenshot' }],
    }),
  ]

  const diary = text(plan(events, true), 'quartz/content/diary/2025.md')
  assert.match(diary, /## 2025-03-01/)
  assert.match(diary, /\*\*\[\[games\/tunic\|Tunic\]\]\*\*/)
  assert.match(diary, /\*Session · 1h00\*/)
  assert.match(diary, /!\[\[assets\/aa\/a{64}\.webp\]\]/)
})

test('a day heads its entries once, however many of them share it', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T10:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-03-01T11:00:00-03:00', note: 'Morning.' }),
    event('session.open', { session_id: 'S2', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S2', at: '2025-03-01T21:00:00-03:00', note: 'Evening.' }),
  ]

  const diary = text(plan(events), 'quartz/content/diary/2025.md')
  assert.equal(diary.match(/^## 2025-03-01$/gm)?.length, 1)
  // Both sessions are still there, under that one heading.
  assert.match(diary, /Morning\./)
  assert.match(diary, /Evening\./)
})

test('the cover rides with the title, and goes quiet when the tree has no assets', () => {
  const sha = 'c'.repeat(64)
  const events = [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic' }),
    event('game.cover', { game_id: 'G1', sha256: sha, source: 'user' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-03-01T21:00:00-03:00', note: 'Played.' }),
  ]

  const published = text(plan(events, true), 'quartz/content/diary/2025.md')
  assert.match(published, new RegExp(`!\\[\\[assets/cc/${sha}\\.webp\\\\\\|64\\]\\]`))
  // The cover and the text are two columns of one flex row, so the title and
  // the meta line stack to the right of the cover and align with its top.
  // Markdown alone puts the title on the cover's baseline and the meta line
  // underneath it entirely.
  assert.match(published, /<div style="display:flex;align-items:flex-start;gap:0\.75rem">/)
  // Symmetric nesting: a bare embed as a direct flex child keeps its paragraph
  // margin and drops 16px below the title it should line up with.
  const head = published.slice(published.indexOf('<div style="display:flex'))
  assert.match(head, /^<div style="[^"]+">\n\n<div>\n\n!\[\[assets\//)
  // Title and meta are one paragraph, so they stay a block beside the cover.
  assert.match(published, /\*\*\[\[games\/tunic\|Tunic\]\]\*\*\n\*Session · 1h00\*/)

  // With the assets absent there is no cover, so there is no wrapper either —
  // the title and meta stand alone. A cover is not worth the "image not
  // published" line a photo earns, the same call assetThumb already makes for
  // the consolidated table.
  const withheld = text(plan(events, false), 'quartz/content/diary/2025.md')
  assert.equal(withheld.includes('![[assets/'), false)
  assert.equal(withheld.includes('<div'), false)
  assert.match(withheld, /^\*\*\[\[games\/tunic\|Tunic\]\]\*\*$/m)
})

test('a photo filed against the game itself still reaches the diary', () => {
  // The regression this covers: `gamereg attach <game>` resolves to a game and
  // to no session and no run, and the first version of diaryEntries had a
  // branch for each of those two and none for this — so every game-level photo
  // in the register was silently dropped from the page.
  const events = [
    event('game.create', { game_id: 'G1', slug: 'toem', title: 'Toem' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-03-01T21:00:00-03:00', note: 'Fotografei tudo.' }),
    event('attachment.add', { target: 'G1', attachments: [photo('a')] }, '2025-03-02T09:00:00-03:00'),
  ]

  const diary = text(plan(events, true), 'quartz/content/diary/2025.md')
  assert.match(diary, /## 2025-03-02/)
  assert.match(diary, /\*Photo\*/)
  assert.match(diary, new RegExp(`!\\[\\[assets/aa/${'a'.repeat(64)}\\.webp\\]\\]`))
})

test("a day's photos of one game are one entry, however many attach commands filed them", () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'toem', title: 'Toem' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-03-01T21:00:00-03:00', note: 'Joguei.' }),
    // Three separate commands, same game, same day.
    event('attachment.add', { target: 'G1', attachments: [photo('a')] }, '2025-03-02T09:00:00-03:00'),
    event('attachment.add', { target: 'G1', attachments: [photo('b')] }, '2025-03-02T10:00:00-03:00'),
    event('attachment.add', { target: 'G1', attachments: [photo('c')] }, '2025-03-02T11:00:00-03:00'),
    // And one the next day, which is its own entry.
    event('attachment.add', { target: 'G1', attachments: [photo('d')] }, '2025-03-03T09:00:00-03:00'),
  ]

  const diary = text(plan(events, true), 'quartz/content/diary/2025.md')
  // One heading per day, one Toem entry under each.
  assert.equal(diary.match(/\*Photos · 3\*/g)?.length, 1)
  assert.equal(diary.match(/\*Photo\*/g)?.length, 1)
  for (const hex of ['aa', 'bb', 'cc', 'dd']) {
    assert.match(diary, new RegExp(`assets/${hex}/`), `foto ${hex} ausente`)
  }
})

test('a photo is dated by its capture, not by the day it was filed', () => {
  // Filed in March, taken in January: a timeline says January. Absent EXIF it
  // falls back to the filing, which is all the register knows.
  const events = [
    event('game.create', { game_id: 'G1', slug: 'toem', title: 'Toem' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-01-05', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-01-05T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-01-05T21:00:00-03:00', note: 'Joguei.' }),
    event(
      'attachment.add',
      { target: 'G1', attachments: [{ ...photo('a'), captured_at: '2025-01-05T20:30:00-03:00' }] },
      '2025-03-02T09:00:00-03:00',
    ),
  ]

  const diary = text(plan(events, true), 'quartz/content/diary/2025.md')
  assert.match(diary, /## 2025-01-05/)
  assert.equal(diary.includes('## 2025-03-02'), false)
})

test('a session with neither a note nor an attachment produces no entry', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-03-01T21:00:00-03:00' }),
  ]

  const diary = text(plan(events), 'quartz/content/diary/2025.md')
  assert.equal(diary.includes('## 2025-03-01'), false)
  assert.match(diary, /Nothing was written down this year\./)
})

test('a verdict on the same day as a session sorts after it — so it displays first, reverse-chronologically', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-03-01T21:00:00-03:00', note: 'Finished it.' }),
    event('run.close', { run_id: 'R1', ended_on: '2025-03-01', outcome: 'finished' }),
    event('run.verdict', { run_id: 'R1', text: 'A tidy little adventure.' }),
  ]

  const diary = text(plan(events), 'quartz/content/diary/2025.md')
  const verdictAt = diary.indexOf('*Verdict')
  const sessionAt = diary.indexOf('*Session')
  assert.notEqual(verdictAt, -1)
  assert.notEqual(sessionAt, -1)
  assert.ok(verdictAt < sessionAt, 'the verdict should display before the session on the same day')
})

test('a run started in one year and ended in the next files its verdict in the ending year', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-12-30', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-12-30T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-12-30T21:00:00-03:00', note: 'Started it.' }),
    event('run.close', { run_id: 'R1', ended_on: '2026-01-02', outcome: 'finished' }),
    event('run.verdict', { run_id: 'R1', text: 'Finished it in the new year.' }),
    // A 2026 diary page only exists when a session happened in 2026
    // (`yearsPlayed`, ADR 0047) — this second game supplies that session, so
    // the verdict has a page to land on.
    event('game.create', { game_id: 'G2', slug: 'celeste', title: 'Celeste' }),
    event('run.open', { run_id: 'R2', game_id: 'G2', started_on: '2026-01-05', replay: false }),
    event('session.open', { session_id: 'S2', run_id: 'R2', at: '2026-01-05T20:00:00-03:00' }),
    event('session.close', { session_id: 'S2', at: '2026-01-05T21:00:00-03:00', note: 'Unrelated session.' }),
  ]

  const files = plan(events)
  assert.match(text(files, 'quartz/content/diary/2025.md'), /## 2025-12-30/)
  assert.equal(text(files, 'quartz/content/diary/2025.md').includes('Verdict'), false)
  assert.match(text(files, 'quartz/content/diary/2026.md'), /Verdict/)
  assert.match(text(files, 'quartz/content/diary/2026.md'), /> Finished it in the new year\./)
})

test('images.publish off renders the withheld line, not a broken embed', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', {
      session_id: 'S1',
      at: '2025-03-01T21:00:00-03:00',
      attachments: [{ sha256: 'a'.repeat(64), ext: 'webp', caption: null, captured_at: null, kind: 'screenshot' }],
    }),
  ]

  const diary = text(plan(events, false), 'quartz/content/diary/2025.md')
  assert.equal(diary.includes('![[assets/'), false)
  assert.match(diary, /\*image not published\*/)
})

test('a year with no entries at all still gets a page', () => {
  const events = [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic' }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-03-01T21:00:00-03:00' }),
  ]

  const files = plan(events)
  const diary = files.find((file) => file.path === 'quartz/content/diary/2025.md')
  assert.notEqual(diary, undefined)
  assert.match(String(diary?.content), /Nothing was written down this year\./)
})

test('disabling the quartz target removes the diary files', () => {
  const root = join(tempDir('gamereg-diary-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', build: { targets: ['quartz'] } }),
  )
  appendEvents(join(root, 'data', 'events.jsonl'), [
    event('game.create', { game_id: 'G1', slug: 'tunic', title: 'Tunic', genres: [], platforms: [], providers: {}, aliases: [] }),
    event('run.open', { run_id: 'R1', game_id: 'G1', started_on: '2025-03-01', replay: false }),
    event('session.open', { session_id: 'S1', run_id: 'R1', at: '2025-03-01T20:00:00-03:00' }),
    event('session.close', { session_id: 'S1', at: '2025-03-01T21:00:00-03:00', note: 'Started it.' }),
  ])

  const rebuild = (): ReturnType<typeof build> => {
    const vault = openVault(root)
    const state = fold(readEvents(vault.eventsFile), timeContext(vault))
    return build(vault, state, translator('en'))
  }

  rebuild()
  const diaryPath = join(root, 'quartz', 'content', 'diary', '2025.md')
  assert.equal(existsSync(diaryPath), true)

  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', build: { targets: ['obsidian'] } }),
  )
  rebuild()
  assert.equal(existsSync(diaryPath), false)
})
