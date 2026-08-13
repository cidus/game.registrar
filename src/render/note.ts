/**
 * The game note (docs/spec/04-derived.md).
 *
 * Frontmatter is fully regenerated every build; the generated blocks are
 * spliced; everything else in the file is the user's and is never touched.
 */
import { Document, Scalar } from 'yaml'

import { formatHm, formatHours } from '../core/duration.ts'
import type { GameState, RunState, SessionState } from '../core/fold.ts'
import type { Translator } from '../i18n/index.ts'
import { wrapBlock, type BlockContent } from './markers.ts'

export const BLOCK_ORDER = ['header', 'verdict', 'sessions'] as const

/** The run whose facts head the note: the most recent one. */
export function leadRun(game: GameState): RunState | null {
  if (game.runs.length === 0) return null
  const open = game.runs.find((run) => run.open)
  if (open !== undefined) return open
  return [...game.runs].sort((left, right) => {
    const key = `${left.ended_on ?? ''}|${left.run_id}`
    const other = `${right.ended_on ?? ''}|${right.run_id}`
    return key < other ? 1 : key > other ? -1 : 0
  })[0]!
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
function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

export function frontmatter(game: GameState): string {
  const run = leadRun(game)
  const document = new Document({})
  // Short collections are written inline, as in the specification's example.
  const flow = new Set(['genres', 'platforms', 'providers', 'tags'])
  const set = (key: string, value: unknown): void => {
    if (value === null || value === undefined) return
    if (Array.isArray(value) && value.length === 0) return
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return
    document.set(key, flow.has(key) ? document.createNode(value, { flow: true }) : value)
  }

  set('gamereg_id', game.game_id)
  set('title', game.title)
  set('status', game.status)
  set('platform', run?.platform ?? game.platforms[0] ?? null)
  set('release_year', game.release_year)
  set('developer', game.developer)
  set('publisher', game.publisher)
  set('genres', game.genres)
  set('started_on', run?.started_on ?? null)
  set('ended_on', run?.ended_on ?? null)
  // Hours keep their single decimal place, even when it is a zero.
  const hours = new Scalar(Number(formatHours(game.total_minutes)))
  hours.minFractionDigits = 1
  set('hours', hours)
  set('rating', run?.rating ?? null)
  set('difficulty', run?.difficulty ?? null)
  set('completion_criteria', run?.completion_criteria ?? null)
  set('providers', game.providers)
  set('tags', ['gamereg'])

  return document.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()
}

export function headerBlock(game: GameState, bundle: Translator): string {
  const run = leadRun(game)
  const sessions = allSessions(game)
  const parts: string[] = []

  if (game.developer !== null) parts.push(`**${game.developer}**`)
  if (game.release_year !== null) parts.push(String(game.release_year))
  const platform = run?.platform ?? game.platforms[0] ?? null
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

  return parts.join(' · ')
}

/**
 * The verdicts filed for this game, in the order the runs happened. With more
 * than one, each is headed by the period it covers — a replay deserves its own
 * verdict, and the two must not read as one text.
 */
export function verdictBlock(game: GameState, bundle: Translator): string {
  const written = game.runs.filter((run) => run.verdict !== null && run.verdict.trim() !== '')
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

export function sessionsBlock(game: GameState, bundle: Translator): string {
  const sessions = allSessions(game)
  if (sessions.length === 0) return bundle.t('note.sessions.empty')

  const head = `| ${bundle.t('note.sessions.date')} | ${bundle.t('note.sessions.duration')} | ${bundle.t('note.sessions.note')} |`
  const rule = '|---|---|---|'
  const rows = sessions.map((session) => {
    const duration = session.open ? '' : formatHm(session.minutes)
    return `| ${session.logical_day} | ${duration} | ${cell(session.note ?? '')} |`
  })

  return [head, rule, ...rows].join('\n')
}

export function blocksOf(game: GameState, bundle: Translator): BlockContent[] {
  return [
    { block: 'header', content: headerBlock(game, bundle) },
    {
      block: 'verdict',
      content: verdictBlock(game, bundle),
      heading: bundle.t('note.heading.verdict'),
    },
    { block: 'sessions', content: sessionsBlock(game, bundle), heading: bundle.t('note.heading.log') },
  ]
}

/** A brand new note: frontmatter, the blocks in canonical order, a place to write. */
export function newNote(game: GameState, bundle: Translator): string {
  const blocks = blocksOf(game, bundle).filter((entry) => entry.content.trim() !== '')
  const body = blocks
    .map((entry) =>
      entry.heading === undefined
        ? wrapBlock(entry.block, entry.content)
        : `## ${entry.heading}\n\n${wrapBlock(entry.block, entry.content)}`,
    )
    .join('\n\n')

  return `---\n${frontmatter(game)}\n---\n\n${body}\n\n## ${bundle.t('note.heading.notes')}\n`
}
