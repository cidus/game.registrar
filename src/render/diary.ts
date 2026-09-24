/**
 * The diary (docs/spec/04-derived.md "Diary"): a reverse-chronological
 * timeline of session notes, session photos and run verdicts, in the flavour
 * `quartz` consumes.
 *
 * This is the join `attachmentRows` exists to make possible — the run note's
 * `sessions` table carries the note but drops the photos, and the game note's
 * `gallery` carries the photos but drops which session they belong to. It is
 * the register's own log re-cut by time instead of by game, the way `reviews/`
 * re-cuts it by year and `stats.md` by genre; no new fact enters the register
 * that a run note or a game note did not already carry.
 *
 * Two pages are cut from the same entry list: one per year (`diary/<year>.md`)
 * and the site's front page, which carries the most recent entries the log
 * knows about.
 *
 * **No clock is read, on either page.** Which years exist comes from
 * `yearsPlayed(state)`, and the front page takes the *N most recent entries*
 * rather than a window ending today — anchored to the log, so a build in
 * December and a build the following January produce the same bytes. See
 * [ADR 0047](../../docs/decisions/0047-review-reads-no-clock.md) and
 * [ADR 0110](../../docs/decisions/0110-diary-is-not-the-feed.md).
 */
import { attachmentRows, type AttachmentRow } from '../core/attachments.ts'
import { formatHm } from '../core/duration.ts'
import type { GameState, RunState, SessionState, VaultState } from '../core/fold.ts'
import type { Translator } from '../i18n/index.ts'
import { assetEmbed, assetThumb } from './assets.ts'
import { noteRef, type Flavour } from './flavour.ts'
import { wrapBlock, type BlockContent } from './markers.ts'
import { timePlayed } from './played.ts'

export function diaryNoteName(year: number): string {
  return String(year)
}

export function diaryNotePath(year: number): string {
  return `diary/${diaryNoteName(year)}.md`
}

export const DIARY_BLOCK_ORDER = ['entries'] as const

/**
 * How many entries the front page carries. A count rather than a span of days:
 * a page that is always the same length is one whose size is known, and a
 * register left alone for a month still has a front page with something on it.
 */
export const HOME_ENTRIES = 30

/** Obsidian's own `|<width>` embed sizing, as the consolidated table uses. */
const COVER_WIDTH = 64

type SessionEntry = {
  kind: 'session'
  sortKey: string
  tie: string
  displayDate: string
  game: GameState
  session: SessionState
  photos: AttachmentRow[]
}

type VerdictEntry = {
  kind: 'verdict'
  sortKey: string
  tie: string
  displayDate: string
  game: GameState
  run: RunState
  photos: AttachmentRow[]
}

export type DiaryEntry = SessionEntry | VerdictEntry

/** One line, no markup: a caption is prose, not a table cell. */
function cell(value: string | null): string {
  if (value === null) return ''
  return value.replace(/\r?\n/g, ' ').trim()
}

/**
 * Every entry in the register, most recent first, ties broken by ULID.
 *
 * A session qualifies with a note or an attachment of its own; a run qualifies
 * with a verdict or an attachment filed directly against the run (never one
 * filed against one of its sessions — that photo already has its own entry).
 * An open run produces no verdict entry: `ended_on` is what places it on the
 * timeline at all.
 *
 * A run's end is a *date*, not a timestamp, so it sorts on a synthetic
 * `${ended_on}T23:59:59` — which puts a closure after the last session of the
 * day it closed on, the real order of events (ADR 0110).
 */
export function diaryEntries(state: VaultState): DiaryEntry[] {
  const bySession = new Map<string, AttachmentRow[]>()
  const byRun = new Map<string, AttachmentRow[]>()
  for (const row of attachmentRows(state)) {
    if (row.session_id !== null) {
      bySession.set(row.session_id, [...(bySession.get(row.session_id) ?? []), row])
    } else if (row.run_id !== null) {
      byRun.set(row.run_id, [...(byRun.get(row.run_id) ?? []), row])
    }
  }

  const entries: DiaryEntry[] = []

  for (const game of state.games) {
    for (const run of game.runs) {
      for (const session of run.sessions) {
        const photos = bySession.get(session.session_id) ?? []
        if ((session.note ?? '').trim() === '' && photos.length === 0) continue
        entries.push({
          kind: 'session',
          sortKey: session.started_at,
          tie: session.session_id,
          displayDate: session.logical_day,
          game,
          session,
          photos,
        })
      }

      if (run.ended_on === null) continue
      const photos = byRun.get(run.run_id) ?? []
      if ((run.verdict ?? '').trim() === '' && photos.length === 0) continue
      entries.push({
        kind: 'verdict',
        sortKey: `${run.ended_on}T23:59:59`,
        tie: run.run_id,
        displayDate: run.ended_on,
        game,
        run,
        photos,
      })
    }
  }

  return entries.sort((left, right) => {
    const key = `${left.sortKey}|${left.tie}`
    const other = `${right.sortKey}|${right.tie}`
    return key < other ? 1 : key > other ? -1 : 0
  })
}

/**
 * The entries of one year. Filtered on the *displayed* date, after resolution
 * rather than before it, so a run that started in one year and ended in the
 * next files its verdict in the year it closed.
 */
export function entriesOfYear(entries: readonly DiaryEntry[], year: number): DiaryEntry[] {
  return entries.filter((entry) => entry.displayDate.slice(0, 4) === String(year))
}

function photoLine(row: AttachmentRow, bundle: Translator): string {
  const date = (row.captured_at ?? row.filed_at).slice(0, 10)
  const caption = cell(row.caption)
  return date === '' ? caption : caption === '' ? date : bundle.t('note.gallery.captioned', { date, caption })
}

function photosBlock(photos: readonly AttachmentRow[], flavour: Flavour, bundle: Translator): string {
  return photos
    .map((row) => {
      const embed = assetEmbed(row.sha256, flavour, bundle)
      const line = photoLine(row, bundle)
      return line === '' ? embed : `${embed}\n*${line}*`
    })
    .join('\n\n')
}

function sessionMeta(session: SessionState, bundle: Translator): string {
  const parts = [bundle.t('diary.kind.session')]
  if (!session.open) parts.push(formatHm(session.minutes))
  return parts.join(' · ')
}

function verdictMeta(run: RunState, bundle: Translator): string {
  const parts = [bundle.t('diary.kind.verdict')]
  if (run.platform !== null) parts.push(run.platform)
  parts.push(...timePlayed(run.minutes, run.sessions.length, run.stated_minutes, bundle))
  if (run.rating !== null) parts.push(String(run.rating))
  return parts.join(' · ')
}

/** A verdict is the register's opinion of a whole playthrough; a blockquote says so. */
function blockquote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

/**
 * The entry's head: the game's cover, with the title and the meta line stacked
 * to its right and aligned to its top.
 *
 * Markdown alone cannot say "beside, top-aligned" — an inline embed sits on
 * the text baseline, which drops the title to the bottom of a 64px cover and
 * pushes the meta line clear underneath it. So the head is wrapped in a flex
 * `div`, which Quartz passes through while still parsing the Markdown inside
 * it (the wikilink embed and the note link both resolve in there).
 *
 * The style is inline rather than a class because gamereg ships no stylesheet:
 * `quartz/styles/custom.scss` is the user's file, preserved across framework
 * updates by `scripts/vendor-quartz.sh` and never written by a target. A class
 * here would be a selector pointing at CSS that does not exist in any vault
 * until someone writes it by hand, and the page would be misaligned until they
 * did. This is the same call `assetThumb`'s `|64` already makes: the width of
 * a cover is a rendering decision the emitter owns.
 *
 * Only a locally ingested cover has a file to embed, and `assetThumb` yields
 * nothing when the tree carries no assets (`images.publish`) — in either case
 * the head degrades to the title and meta alone, with no wrapper at all.
 */
function entryHead(game: GameState, meta: string, flavour: Flavour): string {
  const title = `**[[${noteRef(flavour, 'games', game.slug)}|${game.title}]]**`
  // One paragraph, so the two lines stay a block the cover can sit beside.
  const lines = `${title}\n*${meta}*`
  const cover = game.cover?.sha256 == null ? '' : assetThumb(game.cover.sha256, flavour, COVER_WIDTH)
  if (cover === '') return lines

  // Both columns are wrapped, and symmetrically: a bare embed as a direct flex
  // child is a `<p>` whose top margin applies, while the text column's `<p>` is
  // one level deeper and its does not — which dropped the cover 16px below the
  // title it was supposed to line up with. Same nesting, same margins, same top.
  return [
    '<div style="display:flex;align-items:flex-start;gap:0.75rem">',
    '',
    '<div>',
    '',
    cover,
    '',
    '</div>',
    '',
    '<div>',
    '',
    lines,
    '',
    '</div>',
    '</div>',
  ].join('\n')
}

function entryBody(entry: DiaryEntry, bundle: Translator, flavour: Flavour): string {
  const sections: string[] = []

  if (entry.kind === 'session') {
    sections.push(entryHead(entry.game, sessionMeta(entry.session, bundle), flavour))
    const note = (entry.session.note ?? '').trim()
    if (note !== '') sections.push(note)
  } else {
    sections.push(entryHead(entry.game, verdictMeta(entry.run, bundle), flavour))
    const verdict = (entry.run.verdict ?? '').trim()
    if (verdict !== '') sections.push(blockquote(verdict))
  }

  const photos = photosBlock(entry.photos, flavour, bundle)
  if (photos !== '') sections.push(photos)

  return sections.join('\n\n')
}

/**
 * The timeline itself: one `##` heading per day, with that day's entries
 * under it. A day is the heading rather than each entry because a date repeated
 * three times down a page is noise, and because it gives Quartz's table of
 * contents a list of dates instead of a list of duplicated game titles.
 *
 * Entries arrive sorted and are grouped by walking them, so the grouping
 * cannot disagree with the order.
 */
export function renderEntries(
  entries: readonly DiaryEntry[],
  bundle: Translator,
  flavour: Flavour,
): string {
  if (entries.length === 0) return bundle.t('diary.empty')

  const days: { day: string; entries: DiaryEntry[] }[] = []
  for (const entry of entries) {
    const last = days[days.length - 1]
    if (last !== undefined && last.day === entry.displayDate) last.entries.push(entry)
    else days.push({ day: entry.displayDate, entries: [entry] })
  }

  return days
    .map(({ day, entries: ofDay }) =>
      [`## ${day}`, ...ofDay.map((entry) => entryBody(entry, bundle, flavour))].join('\n\n'),
    )
    .join('\n\n')
}

export function diaryBlocks(
  state: VaultState,
  year: number,
  bundle: Translator,
  flavour: Flavour,
): BlockContent[] {
  const entries = entriesOfYear(diaryEntries(state), year)
  return [{ block: 'entries', content: renderEntries(entries, bundle, flavour) }]
}

export function diaryFrontmatter(year: number, bundle: Translator): string {
  return [
    `gamereg_year: ${year}`,
    `title: ${bundle.t('diary.title', { year })}`,
    'tags: [gamereg, gamereg/diary]',
  ].join('\n')
}

/**
 * One year's diary, whole. Quartz-only today (`flavour.prose` is false for
 * it), so there is no hand-prose slot to preserve — see `newReview`, which
 * this mirrors.
 */
export function newDiary(state: VaultState, year: number, bundle: Translator, flavour: Flavour): string {
  const body = diaryBlocks(state, year, bundle, flavour)
    .map((entry) => wrapBlock(entry.block, entry.content))
    .join('\n\n')

  if (!flavour.siteFrontmatter) {
    const title = bundle.t('diary.title', { year })
    return `---\n${diaryFrontmatter(year, bundle)}\n---\n\n# ${title}\n\n${body}\n`
  }
  return `---\n${diaryFrontmatter(year, bundle)}\ndraft: false\n---\n\n${body}\n`
}

/**
 * The site's front page: the most recent entries in the register, and a link
 * to the full list of games.
 *
 * `limit` entries rather than a span of days ending today — the register has
 * no "today" (ADR 0047), and a count keeps the page a known size whether the
 * last month held forty sessions or one. A register whose last session was in
 * 2019 gets its 2019 entries here, which is a true statement about it.
 */
export function newDiaryHome(
  state: VaultState,
  bundle: Translator,
  flavour: Flavour,
  allGamesRef: string,
  limit: number = HOME_ENTRIES,
): string {
  const entries = diaryEntries(state).slice(0, limit)
  const link = `[[${allGamesRef}|${bundle.t('table.all_games')}]]`
  const body = wrapBlock('entries', renderEntries(entries, bundle, flavour))

  if (!flavour.siteFrontmatter) {
    return `# ${bundle.t('diary.home_title')}\n\n${link}\n\n${body}\n`
  }
  return `---\ntitle: ${bundle.t('diary.home_title')}\ntags: [gamereg, gamereg/diary]\ndraft: false\n---\n\n${link}\n\n${body}\n`
}
