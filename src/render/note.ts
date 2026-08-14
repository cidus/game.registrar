/**
 * The game note (docs/spec/04-derived.md "Game note").
 *
 * The note a person opens, and the only generated file in the vault that also
 * holds hand-written prose. Frontmatter is fully regenerated every build; the
 * generated blocks are spliced; everything else in the file is the user's and is
 * never touched.
 *
 * Frontmatter here is **aggregate**, across runs. Per-run values live on the run
 * note, which is what query views read — and the session log lives there too,
 * because it belongs to a run and a game with two playthroughs has two of them.
 */
import { Document, Scalar } from 'yaml'

import { formatHm, formatHours } from '../core/duration.ts'
import { attachmentsOfGame, type GameState, type RunState, type SessionState, type VaultState } from '../core/fold.ts'
import type { Translator } from '../i18n/index.ts'
import { atPrecision } from './dates.ts'
import { wrapBlock, type BlockContent } from './markers.ts'
import { runNoteNames, runsInOrder } from './run.ts'

export const BLOCK_ORDER = ['header', 'verdict', 'runs', 'gallery'] as const

/** Every attachment is normalized to WebP by the ingestion pipeline, so the
 * hash alone determines the path (docs/spec/04-derived.md "Content addressing"). */
function assetPath(sha256: string): string {
  return `assets/${sha256.slice(0, 2)}/${sha256}.webp`
}

/**
 * The run whose facts head the note: the most recently ended one, falling back
 * to the open one when nothing has ended yet. The same rule `gamereg verdict`
 * uses to pick a playthrough, so the note and the command never disagree.
 */
export function latestRun(game: GameState): RunState | null {
  if (game.runs.length === 0) return null
  const ended = game.runs.filter((run) => run.ended_on !== null)
  if (ended.length === 0) return game.runs.find((run) => run.open) ?? game.runs[0] ?? null
  return [...ended].sort((left, right) => {
    const key = `${left.ended_on ?? ''}|${left.run_id}`
    const other = `${right.ended_on ?? ''}|${right.run_id}`
    return key < other ? 1 : key > other ? -1 : 0
  })[0]!
}

/**
 * The platform this game's note leads with: the latest run's, falling back to
 * any other run that recorded one.
 *
 * Never `game.platforms[0]` — that list is what the *catalog* says the game
 * exists on, and answering "where did you play it" with "IGDB lists PC first"
 * is a claim nobody made. A game whose runs recorded no platform renders
 * without one (docs/spec/04-derived.md).
 */
export function recordedPlatform(game: GameState): string | null {
  const latest = latestRun(game)
  if (latest?.platform != null) return latest.platform
  return game.runs.map((run) => run.platform).find((platform) => platform !== null) ?? null
}

export function allSessions(game: GameState): SessionState[] {
  return game.runs
    .flatMap((run) => run.sessions)
    .sort((left, right) => {
      const key = `${left.started_at}|${left.session_id}`
      const other = `${right.started_at}|${right.session_id}`
      return key < other ? -1 : key > other ? 1 : 0
    })
}

/** Table cells are one line: pipes escaped, newlines flattened. */
function cell(value: string | number | null): string {
  if (value === null) return ''
  return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

export function frontmatter(game: GameState): string {
  const run = latestRun(game)
  const document = new Document({})
  // Short collections are written inline, as in the specification's example.
  const flow = new Set(['genres', 'platforms', 'providers', 'tags'])
  const set = (key: string, value: unknown): void => {
    if (value === null || value === undefined) return
    if (Array.isArray(value) && value.length === 0) return
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return
    document.set(key, flow.has(key) ? document.createNode(value, { flow: true }) : value)
  }

  const started = game.runs.map((entry) => entry.started_on).filter((value) => value !== '')
  const ended = game.runs
    .map((entry) => entry.ended_on)
    .filter((value): value is string => value !== null)

  set('gamereg_id', game.game_id)
  set('title', game.title)
  set('status', game.status)
  set('platform', recordedPlatform(game))
  set('release_year', game.release_year)
  set('developer', game.developer)
  set('publisher', game.publisher)
  set('genres', game.genres)
  set('first_started_on', started.length === 0 ? null : started.sort()[0])
  set('last_ended_on', ended.length === 0 ? null : ended.sort()[ended.length - 1])
  set('runs', game.runs.length)
  // Hours keep their single decimal place, even when it is a zero.
  const hours = new Scalar(Number(formatHours(game.total_minutes)))
  hours.minFractionDigits = 1
  set('hours', hours)
  set('rating', run?.rating ?? null)
  set('providers', game.providers)
  set('tags', ['gamereg', 'gamereg/game'])

  return document.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()
}

export function headerBlock(game: GameState, bundle: Translator): string {
  const run = latestRun(game)
  const sessions = allSessions(game)
  const parts: string[] = []

  if (game.developer !== null) parts.push(`**${game.developer}**`)
  if (game.release_year !== null) parts.push(String(game.release_year))
  const platform = recordedPlatform(game)
  if (platform !== null) parts.push(platform)

  // Nothing measured yet says nothing about duration: an open session is never
  // estimated, and "0m" would read as a claim.
  if (game.total_minutes > 0) {
    parts.push(
      sessions.length === 1
        ? bundle.t('note.header.total_one', { duration: formatHm(game.total_minutes) })
        : bundle.t('note.header.total', {
            duration: formatHm(game.total_minutes),
            sessions: sessions.length,
          }),
    )
  }

  const lines: string[] = []
  // Only a locally ingested cover has a file to embed. A provider cover is a
  // URL, not an asset on disk — enrich never runs the ingestion pipeline.
  if (game.cover?.sha256 != null) lines.push(`![[${assetPath(game.cover.sha256)}]]`)
  lines.push(parts.join(' · '))
  return lines.join('\n')
}

/**
 * Every photo on this game's timeline, oldest first (docs/spec/04-derived.md
 * "Game note", the Gallery block).
 */
export function galleryBlock(state: VaultState, game: GameState, bundle: Translator): string {
  const items = attachmentsOfGame(state, game)
  if (items.length === 0) return ''

  return items
    .map(({ attachment, at }) => {
      const date = (attachment.captured_at ?? at).slice(0, 10)
      const caption = cell(attachment.caption)
      const line = caption === '' ? date : bundle.t('note.gallery.captioned', { date, caption })
      return `![[${assetPath(attachment.sha256)}]]\n*${line}*`
    })
    .join('\n\n')
}

/**
 * The verdicts filed for this game, in the order the runs happened. With more
 * than one, each is headed by the period it covers — a replay deserves its own
 * verdict, and the two must not read as one text.
 *
 * The verdict is deliberately rendered here as well as in the run note:
 * duplication in generated output costs nothing, and the alternative is a vault
 * where the best thing you wrote about a game is one click away from the page
 * named after the game.
 */
export function verdictBlock(game: GameState, bundle: Translator): string {
  const written = runsInOrder(game).filter(
    (run) => run.verdict !== null && run.verdict.trim() !== '',
  )
  if (written.length === 0) return ''
  if (written.length === 1) return (written[0]?.verdict ?? '').trim()

  return written
    .map((run) => {
      const period =
        run.ended_on === null
          ? bundle.t('note.verdict.period_open', { started: run.started_on })
          : bundle.t('note.verdict.period', { started: run.started_on, ended: run.ended_on })
      return `*${period}*\n\n${(run.verdict ?? '').trim()}`
    })
    .join('\n\n')
}

/** One row per playthrough, each linking to the note that is that playthrough. */
export function runsBlock(game: GameState, bundle: Translator): string {
  const runs = runsInOrder(game)
  if (runs.length === 0) return ''

  const names = runNoteNames(game)
  const head = [
    bundle.t('note.runs.run'),
    bundle.t('note.runs.platform'),
    bundle.t('note.runs.started'),
    bundle.t('note.runs.ended'),
    bundle.t('note.runs.hours'),
    bundle.t('note.runs.rating'),
    bundle.t('note.runs.criteria'),
  ]

  const rows = runs.map((run) => {
    const started = atPrecision(run.started_on, run.started_precision)
    const hours =
      run.hours_source !== 'measured'
        ? `${formatHours(run.minutes)} (${bundle.t('table.stated_marker')})`
        : formatHours(run.minutes)
    return [
      `[[${names.get(run.run_id) ?? ''}\\|${started.slice(0, 4)}]]`,
      cell(run.platform),
      started,
      run.ended_on === null ? '' : atPrecision(run.ended_on, run.ended_precision),
      hours,
      cell(run.rating),
      cell(run.completion_criteria),
    ]
  })

  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n')
}

export function blocksOf(state: VaultState, game: GameState, bundle: Translator): BlockContent[] {
  return [
    { block: 'header', content: headerBlock(game, bundle) },
    {
      block: 'verdict',
      content: verdictBlock(game, bundle),
      heading: bundle.t('note.heading.verdict'),
    },
    { block: 'runs', content: runsBlock(game, bundle), heading: bundle.t('note.heading.runs') },
    {
      block: 'gallery',
      content: galleryBlock(state, game, bundle),
      heading: bundle.t('note.heading.gallery'),
    },
  ]
}

/** A brand new note: frontmatter, the blocks in canonical order, a place to write. */
export function newNote(state: VaultState, game: GameState, bundle: Translator): string {
  const blocks = blocksOf(state, game, bundle).filter((entry) => entry.content.trim() !== '')
  const body = blocks
    .map((entry) =>
      entry.heading === undefined
        ? wrapBlock(entry.block, entry.content)
        : `## ${entry.heading}\n\n${wrapBlock(entry.block, entry.content)}`,
    )
    .join('\n\n')

  return `---\n${frontmatter(game)}\n---\n\n${body}\n\n## ${bundle.t('note.heading.notes')}\n`
}
