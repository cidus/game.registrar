/**
 * Folding the log into derived state (docs/spec/01-model.md "Derived state").
 *
 * The fold is tolerant on purpose: a log that contradicts itself yields state
 * *plus* a list of problems, so `doctor` can report every one of them in a
 * single pass. Commands that write validate up front and never rely on this.
 *
 * Events are folded in file order. `event.revoke` removes a target from the
 * fold; `event.amend` shallow-merges a patch over the target's payload. Neither
 * touches the file.
 */
import type { DateTime } from 'luxon'

import { minutesBetween } from './duration.ts'
import { GameregError } from './errors.ts'
import type { EventEnvelope } from './events.ts'
import { normalize } from '../resolve/normalize.ts'
import { logicalDay, parseISO, type TimeContext } from './time.ts'
import type {
  CheckinOutcome,
  CheckinTrigger,
  CompletionCriteria,
  DatePrecision,
  Difficulty,
  Form,
  GameStatus,
  HoursSource,
  Mode,
  Outcome,
} from './vocab.ts'

export type FoldProblem = {
  key: string
  params: Record<string, unknown>
  event_id: string | null
}

export type Attachment = {
  sha256: string
  ext: string
  caption: string | null
  captured_at: string | null
  kind: string
}

export type BreakState = {
  break_id: string
  session_id: string
  started_at: string
  ended_at: string | null
  minutes: number
  open: boolean
}

export type CheckinState = {
  /**
   * The `session.checkin` event itself. `checkin --expire` amends the record
   * it finds stale, and an amend needs a target: without the id here, the only
   * way back to the event is a second scan of the log by hand.
   */
  event_id: string
  at: string
  trigger: CheckinTrigger
  outcome: CheckinOutcome
}

export type SessionState = {
  session_id: string
  run_id: string
  /**
   * The `session.open` event that started it. Carried for the same reason
   * `CheckinState.event_id` is: `amend` and `revoke` take an *event* id, and
   * without this the only route to one is raw SQL over the `events` table with
   * `json_extract` — which is what the agent was reduced to doing, badly.
   */
  open_event_id: string
  started_at: string
  ended_at: string | null
  /** Net of every break. Zero while open — never estimated. */
  minutes: number
  /** `session.close --break`, additive with logged breaks. */
  declared_break_minutes: number
  break_minutes: number
  note: string | null
  logical_day: string
  open: boolean
  breaks: BreakState[]
  checkins: CheckinState[]
}

export type RunState = {
  run_id: string
  game_id: string
  /**
   * The `run.open` (or `run.import`) event that opened it — the target of
   * every `amend` that corrects a run's own fields, `platform` and the stated
   * `hours` baseline included. See `SessionState.open_event_id`.
   */
  open_event_id: string
  platform: string | null
  /**
   * What the log actually holds, before the build canonicalizes spellings
   * (`targets/build.ts`). The fold sets the two equal — it is pure over events
   * and never reads the platform table — so a difference between them is
   * always the work of the canonicalization pass, and always auditable.
   */
  platform_raw: string | null
  form: Form | null
  mode: Mode | null
  started_on: string
  started_precision: DatePrecision
  ended_on: string | null
  ended_precision: DatePrecision | null
  outcome: Outcome | null
  completion_criteria: CompletionCriteria | null
  rating: number | null
  difficulty: Difficulty | null
  note: string | null
  /** The latest `run.verdict` text. Prose, and never read back into anything. */
  verdict: string | null
  replay: boolean
  sessions: SessionState[]
  /** `run.open.hours` / `run.import.hours`, in minutes. Zero for an ordinary `start`. */
  stated_minutes: number
  minutes: number
  hours_source: HoursSource
  open: boolean
}

export type Cover = {
  sha256: string | null
  url: string | null
  source: 'user' | 'provider'
}

export type GameState = {
  game_id: string
  slug: string
  /** Slugs this game used before a rename; build removes their orphaned notes. */
  previous_slugs: string[]
  title: string
  sort_title: string | null
  release_year: number | null
  developer: string | null
  publisher: string | null
  genres: string[]
  platforms: string[]
  providers: Record<string, string | number>
  /** Providers a real `game.enrich` has actually completed for — unlike `providers`, never set by a bare create-time reference (docs/spec/02-cli.md, `enrich --missing`). */
  enrichedProviders: string[]
  aliases: string[]
  cover: Cover | null
  runs: RunState[]
  total_minutes: number
  status: GameStatus
}

export type VaultState = {
  games: GameState[]
  gamesById: Map<string, GameState>
  runsById: Map<string, RunState>
  sessionsById: Map<string, SessionState>
  breaksById: Map<string, BreakState>
  /** Keyed by target: an event id, or a game id. Collected before anything renders it. */
  attachments: Map<string, Attachment[]>
  eventsById: Map<string, EventEnvelope>
  problems: FoldProblem[]
}

const str = (data: Record<string, unknown>, key: string): string | null => {
  const value = data[key]
  return typeof value === 'string' && value !== '' ? value : null
}

const num = (data: Record<string, unknown>, key: string): number | null => {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const bool = (data: Record<string, unknown>, key: string): boolean => data[key] === true

const strArray = (data: Record<string, unknown>, key: string): string[] => {
  const value = data[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

const record = (data: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = data[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function attachmentsOf(data: Record<string, unknown>): Attachment[] {
  const value = data['attachments']
  if (!Array.isArray(value)) return []
  const out: Attachment[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const sha256 = str(entry, 'sha256')
    if (sha256 === null) continue
    out.push({
      sha256,
      ext: str(entry, 'ext') ?? 'webp',
      caption: str(entry, 'caption'),
      captured_at: str(entry, 'captured_at'),
      kind: str(entry, 'kind') ?? 'other',
    })
  }
  return out
}

/**
 * Resolves `event.revoke` and `event.amend` into an effective payload per event.
 * A revoked amend does not apply; a revoked revoke does not revoke.
 */
function applyCorrections(events: readonly EventEnvelope[]): {
  revoked: Set<string>
  patched: Map<string, Record<string, unknown>>
} {
  const revoked = new Set<string>()
  // Two passes: the second lets a revoke that was itself revoked drop out.
  for (let pass = 0; pass < 2; pass += 1) {
    revoked.clear()
    for (const event of events) {
      if (event.type !== 'event.revoke') continue
      if (pass > 0 && revoked.has(event.id)) continue
      const target = str(event.data, 'target')
      if (target !== null) revoked.add(target)
    }
  }

  const patched = new Map<string, Record<string, unknown>>()
  for (const event of events) {
    if (event.type !== 'event.amend') continue
    if (revoked.has(event.id)) continue
    const target = str(event.data, 'target')
    if (target === null) continue
    const patch = record(event.data, 'patch')
    patched.set(target, { ...(patched.get(target) ?? {}), ...patch })
  }

  return { revoked, patched }
}

function statusOf(runs: readonly RunState[]): GameStatus {
  if (runs.length === 0) return 'unplayed'
  if (runs.some((run) => run.open)) return 'playing'

  let last: RunState | null = null
  for (const run of runs) {
    if (run.outcome === null) continue
    if (last === null) {
      last = run
      continue
    }
    const key = `${run.ended_on ?? ''}|${run.run_id}`
    const bestKey = `${last.ended_on ?? ''}|${last.run_id}`
    if (key > bestKey) last = run
  }
  return last?.outcome ?? 'unplayed'
}

export function fold(events: readonly EventEnvelope[], context: TimeContext): VaultState {
  const state: VaultState = {
    games: [],
    gamesById: new Map(),
    runsById: new Map(),
    sessionsById: new Map(),
    breaksById: new Map(),
    attachments: new Map(),
    eventsById: new Map(),
    problems: [],
  }

  const problem = (key: string, event: EventEnvelope | null, params: Record<string, unknown> = {}): void => {
    state.problems.push({ key, params, event_id: event?.id ?? null })
  }

  const { revoked, patched } = applyCorrections(events)

  for (const event of events) state.eventsById.set(event.id, event)

  const instant = (value: string | null, event: EventEnvelope): DateTime | null => {
    if (value === null) return null
    try {
      return parseISO(value, context)
    } catch {
      problem('doctor.bad_timestamp', event, { value })
      return null
    }
  }

  const addAttachments = (target: string, items: readonly Attachment[]): void => {
    if (items.length === 0) return
    const existing = state.attachments.get(target) ?? []
    for (const item of items) {
      if (!existing.some((known) => known.sha256 === item.sha256)) existing.push(item)
    }
    state.attachments.set(target, existing)
  }

  for (const event of events) {
    if (revoked.has(event.id)) continue
    if (event.type === 'event.amend' || event.type === 'event.revoke') continue

    const data: Record<string, unknown> = { ...event.data, ...(patched.get(event.id) ?? {}) }
    addAttachments(event.id, attachmentsOf(data))

    switch (event.type) {
      case 'game.create': {
        const gameId = str(data, 'game_id')
        const title = str(data, 'title')
        const slug = str(data, 'slug')
        if (gameId === null || title === null || slug === null) {
          problem('doctor.incomplete_event', event, { type: event.type })
          break
        }
        if (state.gamesById.has(gameId)) {
          problem('doctor.duplicate_game', event, { game_id: gameId })
          break
        }
        const providers: Record<string, string | number> = {}
        for (const [key, value] of Object.entries(record(data, 'providers'))) {
          if (typeof value === 'string' || typeof value === 'number') providers[key] = value
        }
        const game: GameState = {
          game_id: gameId,
          slug,
          previous_slugs: [],
          title,
          sort_title: str(data, 'sort_title'),
          release_year: num(data, 'release_year'),
          developer: str(data, 'developer'),
          publisher: str(data, 'publisher'),
          genres: strArray(data, 'genres'),
          platforms: strArray(data, 'platforms'),
          providers,
          enrichedProviders: [],
          aliases: strArray(data, 'aliases'),
          cover: null,
          runs: [],
          total_minutes: 0,
          status: 'unplayed',
        }
        state.games.push(game)
        state.gamesById.set(gameId, game)
        break
      }

      case 'game.alias': {
        const game = state.gamesById.get(str(data, 'game_id') ?? '')
        const alias = str(data, 'alias')
        if (game === undefined || alias === null) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        // An alias is per-game and unique: teaching it again moves it, which is
        // what `gamereg alias` promises — by appending, never by deleting.
        for (const other of state.games) {
          if (other === game) continue
          other.aliases = other.aliases.filter((known) => known !== alias)
        }
        if (!game.aliases.includes(alias)) game.aliases.push(alias)
        break
      }

      case 'game.rename': {
        const game = state.gamesById.get(str(data, 'game_id') ?? '')
        if (game === undefined) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        const slug = str(data, 'slug')
        if (slug !== null && slug !== game.slug) {
          game.previous_slugs.push(game.slug)
          game.slug = slug
        }
        const title = str(data, 'title')
        if (title !== null) game.title = title
        break
      }

      case 'game.enrich': {
        const game = state.gamesById.get(str(data, 'game_id') ?? '')
        const provider = str(data, 'provider')
        if (game === undefined || provider === null) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        const fields = record(data, 'fields')
        // A provider-corrected title replaces the stored one wholesale, same
        // as every other enriched field — but the title just left behind is
        // still how the user knows this game, so it becomes an alias rather
        // than disappearing (docs/spec/01-model.md).
        const title = str(fields, 'title')
        if (title !== null && title !== game.title) {
          const previous = normalize(game.title)
          if (previous !== '' && previous !== normalize(title) && !game.aliases.includes(previous)) {
            game.aliases.push(previous)
          }
          game.title = title
        }
        const year = num(fields, 'release_year')
        if (year !== null) game.release_year = year
        const developer = str(fields, 'developer')
        if (developer !== null) game.developer = developer
        const publisher = str(fields, 'publisher')
        if (publisher !== null) game.publisher = publisher
        const genres = strArray(fields, 'genres')
        if (genres.length > 0) game.genres = genres
        const platforms = strArray(fields, 'platforms')
        if (platforms.length > 0) game.platforms = platforms
        const providerId = fields['id']
        if (typeof providerId === 'string' || typeof providerId === 'number') {
          game.providers[provider] = providerId
          if (!game.enrichedProviders.includes(provider)) game.enrichedProviders.push(provider)
        }
        // A user cover is never replaced by enrichment (01-model, cover precedence).
        // `cover` was a bare URL string before the download pipeline existed;
        // both shapes are read forever, since the log is append-only and an
        // old `game.enrich` event still folds exactly as it did when written.
        const coverRaw = data['cover']
        const coverUrl = typeof coverRaw === 'string' && coverRaw !== '' ? coverRaw : str(record(data, 'cover'), 'url')
        const coverSha = str(record(data, 'cover'), 'sha256')
        if ((coverUrl !== null || coverSha !== null) && game.cover?.source !== 'user') {
          game.cover = { sha256: coverSha, url: coverUrl, source: 'provider' }
        }
        break
      }

      case 'game.cover': {
        const game = state.gamesById.get(str(data, 'game_id') ?? '')
        if (game === undefined) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        const source = str(data, 'source') === 'user' ? 'user' : 'provider'
        game.cover = { sha256: str(data, 'sha256'), url: str(data, 'url'), source }
        break
      }

      case 'run.open':
      case 'run.import': {
        const runId = str(data, 'run_id')
        const game = state.gamesById.get(str(data, 'game_id') ?? '')
        const startedOn = str(data, 'started_on')
        if (runId === null || game === undefined) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        if (state.runsById.has(runId)) {
          problem('doctor.duplicate_run', event, { run_id: runId })
          break
        }
        const imported = event.type === 'run.import'
        // `run.import` always closes on arrival — `ended_on` is required there.
        // `run.open` is closed only by a later `run.close`; a stated `hours`
        // baseline on it (`start --past-hours`, `past` without `--ended`)
        // doesn't change that, it just seeds `stated_minutes` before any
        // session exists.
        const precision = (str(data, 'date_precision') ?? 'day') as DatePrecision
        const hours = num(data, 'hours')
        const statedMinutes = hours !== null ? Math.round(hours * 60) : 0
        const run: RunState = {
          run_id: runId,
          game_id: game.game_id,
          open_event_id: event.id,
          platform: str(data, 'platform'),
          platform_raw: str(data, 'platform'),
          form: str(data, 'form') as Form | null,
          mode: str(data, 'mode') as Mode | null,
          started_on: startedOn ?? str(data, 'ended_on') ?? '',
          started_precision: precision,
          ended_on: imported ? str(data, 'ended_on') : null,
          ended_precision: imported ? precision : null,
          outcome: imported ? ((str(data, 'outcome') ?? 'finished') as Outcome) : null,
          completion_criteria: imported
            ? (str(data, 'completion_criteria') as CompletionCriteria | null)
            : null,
          rating: imported ? num(data, 'rating') : null,
          difficulty: imported ? (str(data, 'difficulty') as Difficulty | null) : null,
          note: imported ? str(data, 'note') : null,
          verdict: null,
          replay: bool(data, 'replay'),
          sessions: [],
          stated_minutes: statedMinutes,
          minutes: statedMinutes,
          hours_source: statedMinutes > 0 ? 'stated' : 'measured',
          open: !imported,
        }
        state.runsById.set(runId, run)
        game.runs.push(run)
        if (run.platform !== null && !game.platforms.includes(run.platform)) {
          game.platforms.push(run.platform)
        }
        break
      }

      case 'run.close': {
        const run = state.runsById.get(str(data, 'run_id') ?? '')
        if (run === undefined) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        if (!run.open) {
          problem('doctor.run_closed_twice', event, { run_id: run.run_id })
          break
        }
        run.ended_on = str(data, 'ended_on')
        run.ended_precision = (str(data, 'date_precision') ?? 'day') as DatePrecision
        run.outcome = (str(data, 'outcome') ?? 'finished') as Outcome
        run.completion_criteria = str(data, 'completion_criteria') as CompletionCriteria | null
        run.rating = num(data, 'rating')
        run.difficulty = str(data, 'difficulty') as Difficulty | null
        run.note = str(data, 'note')
        run.open = false
        break
      }

      case 'run.verdict': {
        const run = state.runsById.get(str(data, 'run_id') ?? '')
        if (run === undefined) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        // Filing again replaces the previous verdict; both stay in the file.
        run.verdict = str(data, 'text')
        break
      }

      case 'session.open': {
        const sessionId = str(data, 'session_id')
        const run = state.runsById.get(str(data, 'run_id') ?? '')
        const at = instant(str(data, 'at'), event)
        if (sessionId === null || run === undefined || at === null) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        if (state.sessionsById.has(sessionId)) {
          problem('doctor.duplicate_session', event, { session_id: sessionId })
          break
        }
        const session: SessionState = {
          session_id: sessionId,
          run_id: run.run_id,
          open_event_id: event.id,
          started_at: str(data, 'at') ?? '',
          ended_at: null,
          minutes: 0,
          declared_break_minutes: 0,
          break_minutes: 0,
          note: null,
          logical_day: logicalDay(at, context.dayCutoff),
          open: true,
          breaks: [],
          checkins: [],
        }
        state.sessionsById.set(sessionId, session)
        run.sessions.push(session)
        break
      }

      case 'session.close': {
        const session = state.sessionsById.get(str(data, 'session_id') ?? '')
        if (session === undefined) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        if (!session.open) {
          problem('doctor.session_closed_twice', event, { session_id: session.session_id })
          break
        }
        const closedAt = instant(str(data, 'at'), event)
        const openedAt = instant(session.started_at, event)
        if (closedAt === null || openedAt === null) break

        // A break left open when the session closes is closed at the same instant.
        for (const item of session.breaks) {
          if (!item.open) continue
          const breakStart = instant(item.started_at, event)
          item.ended_at = str(data, 'at')
          item.open = false
          item.minutes = breakStart === null ? 0 : Math.max(0, minutesBetween(breakStart, closedAt))
        }

        const declared = num(data, 'break_minutes') ?? 0
        const logged = session.breaks.reduce((total, item) => total + item.minutes, 0)
        const gross = minutesBetween(openedAt, closedAt)
        const net = gross - logged - declared

        session.ended_at = str(data, 'at')
        session.note = str(data, 'note')
        session.declared_break_minutes = declared
        session.break_minutes = logged + declared
        session.open = false

        if (gross < 0) {
          problem('doctor.closed_before_open', event, { session_id: session.session_id })
          session.minutes = 0
        } else if (net < 0) {
          problem('doctor.negative_duration', event, { session_id: session.session_id })
          session.minutes = 0
        } else {
          session.minutes = net
        }
        break
      }

      case 'break.open': {
        const breakId = str(data, 'break_id')
        const session = state.sessionsById.get(str(data, 'session_id') ?? '')
        if (breakId === null || session === undefined) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        if (!session.open) {
          problem('doctor.break_outside_session', event, { break_id: breakId })
          break
        }
        if (session.breaks.some((item) => item.open)) {
          problem('doctor.break_already_open', event, { session_id: session.session_id })
          break
        }
        const entry: BreakState = {
          break_id: breakId,
          session_id: session.session_id,
          started_at: str(data, 'at') ?? '',
          ended_at: null,
          minutes: 0,
          open: true,
        }
        state.breaksById.set(breakId, entry)
        session.breaks.push(entry)
        break
      }

      case 'break.close': {
        const entry = state.breaksById.get(str(data, 'break_id') ?? '')
        if (entry === undefined || !entry.open) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        const startedAt = instant(entry.started_at, event)
        const endedAt = instant(str(data, 'at'), event)
        if (startedAt === null || endedAt === null) break
        const minutes = minutesBetween(startedAt, endedAt)
        if (minutes < 0) {
          problem('doctor.negative_duration', event, { break_id: entry.break_id })
          entry.minutes = 0
        } else {
          entry.minutes = minutes
        }
        entry.ended_at = str(data, 'at')
        entry.open = false
        break
      }

      case 'session.checkin': {
        const session = state.sessionsById.get(str(data, 'session_id') ?? '')
        if (session === undefined) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        session.checkins.push({
          event_id: event.id,
          at: str(data, 'at') ?? event.ts,
          trigger: (str(data, 'trigger') ?? 'duration') as CheckinTrigger,
          outcome: (str(data, 'outcome') ?? 'no_reply') as CheckinOutcome,
        })
        break
      }

      case 'attachment.add': {
        const target = str(data, 'target')
        if (target === null) {
          problem('doctor.incomplete_event', event, { type: event.type })
          break
        }
        if (!state.eventsById.has(target) && !state.gamesById.has(target)) {
          problem('doctor.orphan_reference', event, { type: event.type })
          break
        }
        addAttachments(target, attachmentsOf(data))
        break
      }

      // Reserved for board games; folded by a later version.
      case 'person.create':
      case 'play.record':
        break
    }
  }

  for (const game of state.games) {
    for (const run of game.runs) {
      const measured = run.sessions.reduce((total, session) => total + session.minutes, 0)
      run.minutes = run.stated_minutes + measured
      run.hours_source = run.stated_minutes > 0 ? (measured > 0 ? 'mixed' : 'stated') : 'measured'
    }
    game.total_minutes = game.runs.reduce((total, run) => total + run.minutes, 0)
    game.status = statusOf(game.runs)
  }

  return state
}

/** The game an event belongs to, by its `game_id`, `run_id` or `session_id` — whichever it carries. */
export function gameOfEvent(state: VaultState, event: EventEnvelope): GameState | null {
  const data = event.data
  const gameId = str(data, 'game_id')
  if (gameId !== null) return state.gamesById.get(gameId) ?? null
  const runId = str(data, 'run_id')
  const sessionId = str(data, 'session_id')
  const run = runId !== null ? state.runsById.get(runId) : state.runsById.get(state.sessionsById.get(sessionId ?? '')?.run_id ?? '')
  return run === undefined ? null : (state.gamesById.get(run.game_id) ?? null)
}

export type GameAttachment = { attachment: Attachment; at: string }

/**
 * Every attachment on this game's timeline, chronological: filed directly
 * against the game (`attach <game>`, `cover --photo`/`--from`) plus anything
 * inline or retroactively added to an event that belongs to one of its runs
 * or sessions.
 *
 * `state.attachments` (built by the main fold above) is keyed by *target* — an
 * event id, or a game id — with no notion of which game an event belongs to.
 * This walks the events once to resolve that ownership, the same way
 * `gameOfSession` does for a single session, and de-duplicates by hash: the
 * same photo attached at two levels is one entry in the gallery.
 */
export function attachmentsOfGame(state: VaultState, game: GameState): GameAttachment[] {
  const collected: GameAttachment[] = []
  const seen = new Set<string>()

  const add = (target: string, at: string): void => {
    for (const attachment of state.attachments.get(target) ?? []) {
      if (seen.has(attachment.sha256)) continue
      seen.add(attachment.sha256)
      collected.push({ attachment, at })
    }
  }

  // A game-level attachment (`gamereg attach <game>`, `cover --photo`) has no
  // session or run to date it, so it is dated by the event that filed it.
  // Looked up by hash rather than trusted wholesale: `state.attachments` is
  // correction-aware and these raw payloads are not, so a hash the map does
  // not hold is never reached, and one it holds under an amended value finds
  // no date here instead of the wrong one.
  const filedAt = new Map<string, string>()
  for (const event of state.eventsById.values()) {
    if (str(event.data, 'target') !== game.game_id) continue
    for (const attachment of attachmentsOf(event.data)) {
      if (!filedAt.has(attachment.sha256)) filedAt.set(attachment.sha256, event.ts)
    }
  }
  for (const attachment of state.attachments.get(game.game_id) ?? []) {
    if (seen.has(attachment.sha256)) continue
    seen.add(attachment.sha256)
    collected.push({ attachment, at: filedAt.get(attachment.sha256) ?? '' })
  }

  for (const event of state.eventsById.values()) {
    if (!state.attachments.has(event.id)) continue
    if (gameOfEvent(state, event)?.game_id !== game.game_id) continue
    add(event.id, str(event.data, 'at') ?? event.ts)
  }

  return collected.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))
}

/** Every session still open, in the order the log put their games in. */
export function openSessions(state: VaultState): SessionState[] {
  const sessions: SessionState[] = []
  for (const game of state.games) {
    for (const run of game.runs) {
      for (const session of run.sessions) {
        if (session.open) sessions.push(session)
      }
    }
  }
  return sessions
}

/** The game a session belongs to. Unreachable unless the fold contradicts itself. */
export function gameOfSession(state: VaultState, session: SessionState): GameState {
  const run = state.runsById.get(session.run_id)
  const game = run === undefined ? undefined : state.gamesById.get(run.game_id)
  if (game === undefined) throw new GameregError('error', 'error.unexpected', { message: session.session_id })
  return game
}
