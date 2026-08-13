/**
 * The run note (docs/spec/04-derived.md "Run note").
 *
 * `runs/<slug>-<started_on>.md`, one per playthrough. Fully generated, no prose,
 * safe to delete. It exists to be a row: it is what makes a playthrough
 * addressable, queryable and linkable, and it is why a replay can appear in a
 * query view at all.
 *
 * Unlike a game note this file is written whole and never parsed back. The
 * markers are emitted anyway, so both kinds of note read the same and a block
 * can be added later without changing the file format.
 */
import { Document, Scalar } from 'yaml'

import { formatHm, formatHours } from '../core/duration.ts'
import type { GameState, RunState, SessionState } from '../core/fold.ts'
import type { Translator } from '../i18n/index.ts'
import { atPrecision } from './dates.ts'
import { wrapBlock, type BlockContent } from './markers.ts'

export const RUN_BLOCK_ORDER = ['header', 'verdict', 'sessions'] as const

/** Chronological, ties broken by ULID — the order the playthroughs happened. */
export function runsInOrder(game: GameState): RunState[] {
  return [...game.runs].sort((left, right) => {
    const key = `${left.started_on}|${left.run_id}`
    const other = `${right.started_on}|${right.run_id}`
    return key < other ? -1 : key > other ? 1 : 0
  })
}

/**
 * `run_id` → note basename, without the extension.
 *
 * `<slug>-<started_on>` at the stored precision, so `chrono-trigger-2011` and
 * not `chrono-trigger-2011-01-01`. Two runs of one game starting on the same
 * date — vanishingly rare, but possible — take `-2`, `-3` in ULID order. Two
 * *different* games cannot collide here, since the slug differs.
 */
export function runNoteNames(game: GameState): Map<string, string> {
  const byBase = new Map<string, RunState[]>()
  for (const run of [...game.runs].sort((left, right) => (left.run_id < right.run_id ? -1 : 1))) {
    const base = `${game.slug}-${atPrecision(run.started_on, run.started_precision)}`
    byBase.set(base, [...(byBase.get(base) ?? []), run])
  }

  const names = new Map<string, string>()
  for (const [base, runs] of byBase) {
    runs.forEach((run, index) => names.set(run.run_id, index === 0 ? base : `${base}-${index + 1}`))
  }
  return names
}

export function runNotePath(game: GameState, run: RunState): string {
  return `runs/${runNoteNames(game).get(run.run_id) ?? `${game.slug}-${run.started_on}`}.md`
}

/** `playing` while open, the outcome afterwards — spelled as the game's status. */
export function runStatus(run: RunState): string | null {
  return run.open ? 'playing' : run.outcome
}

export function sessionsOf(run: RunState): SessionState[] {
  return [...run.sessions].sort((left, right) => {
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

export function runFrontmatter(game: GameState, run: RunState): string {
  const document = new Document({})
  const flow = new Set(['genres', 'tags'])
  const set = (key: string, value: unknown): void => {
    if (value === null || value === undefined) return
    if (Array.isArray(value) && value.length === 0) return
    document.set(key, flow.has(key) ? document.createNode(value, { flow: true }) : value)
  }

  set('gamereg_run_id', run.run_id)
  set('gamereg_id', game.game_id)
  set('title', game.title)
  set('game', `[[${game.slug}]]`)
  set('status', runStatus(run))
  set('platform', run.platform)
  set('form', run.form)
  set('mode', run.mode)
  set('started_on', run.started_on)
  set('ended_on', run.ended_on)
  set('date_precision', run.started_precision)
  const hours = new Scalar(Number(formatHours(run.minutes)))
  hours.minFractionDigits = 1
  set('hours', hours)
  set('hours_source', run.hours_source)
  set('sessions', run.sessions.length)
  set('rating', run.rating)
  set('difficulty', run.difficulty)
  set('completion_criteria', run.completion_criteria)
  set('replay', run.replay)
  // Denormalized from the game: Bases has no joins, and filtering runs by genre
  // is the single most obvious question a register gets asked.
  set('release_year', game.release_year)
  set('developer', game.developer)
  set('genres', game.genres)
  set('tags', ['gamereg', 'gamereg/run'])

  return document.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()
}

export function runHeaderBlock(game: GameState, run: RunState, bundle: Translator): string {
  const parts: string[] = [`[[${game.slug}|${game.title}]]`]
  if (run.platform !== null) parts.push(run.platform)

  const started = atPrecision(run.started_on, run.started_precision)
  const ended = run.ended_on === null ? null : atPrecision(run.ended_on, run.ended_precision)
  parts.push(ended === null ? started : `${started} → ${ended}`)

  // Nothing measured yet says nothing about duration: an open session is never
  // estimated, and "0m" would read as a claim.
  if (run.minutes > 0) {
    parts.push(
      run.sessions.length === 1
        ? bundle.t('note.header.total_one', { duration: formatHm(run.minutes) })
        : bundle.t('note.header.total', {
            duration: formatHm(run.minutes),
            sessions: run.sessions.length,
          }),
    )
  }

  return parts.join(' · ')
}

export function runVerdictBlock(run: RunState): string {
  return (run.verdict ?? '').trim()
}

export function runSessionsBlock(run: RunState, bundle: Translator): string {
  const sessions = sessionsOf(run)
  if (sessions.length === 0) return bundle.t('note.sessions.empty')

  const head = `| ${bundle.t('note.sessions.date')} | ${bundle.t('note.sessions.duration')} | ${bundle.t('note.sessions.note')} |`
  const rule = '|---|---|---|'
  const rows = sessions.map((session) => {
    const duration = session.open ? '' : formatHm(session.minutes)
    return `| ${session.logical_day} | ${duration} | ${cell(session.note)} |`
  })

  return [head, rule, ...rows].join('\n')
}

export function runBlocks(game: GameState, run: RunState, bundle: Translator): BlockContent[] {
  return [
    { block: 'header', content: runHeaderBlock(game, run, bundle) },
    { block: 'verdict', content: runVerdictBlock(run), heading: bundle.t('note.heading.verdict') },
    {
      block: 'sessions',
      content: runSessionsBlock(run, bundle),
      heading: bundle.t('note.heading.log'),
    },
  ]
}

/** The whole file. There is no other form: a run note is never spliced. */
export function newRunNote(game: GameState, run: RunState, bundle: Translator): string {
  const body = runBlocks(game, run, bundle)
    .filter((entry) => entry.content.trim() !== '')
    .map((entry) =>
      entry.heading === undefined
        ? wrapBlock(entry.block, entry.content)
        : `## ${entry.heading}\n\n${wrapBlock(entry.block, entry.content)}`,
    )
    .join('\n\n')

  return `---\n${runFrontmatter(game, run)}\n---\n\n${body}\n`
}
