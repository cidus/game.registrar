/**
 * Shared command plumbing: read the log, resolve a game, decide run defaults,
 * append.
 *
 * Every command builds its events in memory, re-folds the log *with* them to
 * see the resulting state, and appends once at the end. That way `--dry-run`
 * and a real run go down exactly the same path.
 */
import { hoursToMinutes } from '../core/duration.ts'
import { GameregError } from '../core/errors.ts'
import { appendEvents, makeEvent, readEvents, type EventEnvelope } from '../core/events.ts'
import { fold, type GameState, type RunState, type SessionState, type VaultState } from '../core/fold.ts'
import { newId } from '../core/ids.ts'
import {
  canonicalPlatform,
  platformGroups,
  platformTable,
  soleMatch,
  type PlatformSource,
} from '../core/platforms.ts'
import { logicalDay, toISO } from '../core/time.ts'
import { checkEnum, FORM, MODE, type DatePrecision, type Form, type Mode } from '../core/vocab.ts'
import { normalize, uniqueSlug } from '../resolve/normalize.ts'
import { candidateOf, parseReference, resolveLocal, type Candidate, type ResolveOptions } from '../resolve/resolve.ts'
import type { Cli } from './context.ts'
import { choose } from './prompt.ts'

export type Workspace = {
  events: EventEnvelope[]
  state: VaultState
  /** Events this invocation intends to append, in order. */
  pending: EventEnvelope[]
}

export function load(cli: Cli): Workspace {
  const events = readEvents(cli.vault.eventsFile)
  return { events, state: fold(events, cli.time), pending: [] }
}

/** Re-folds the log with the pending events applied, so state is always current. */
export function refold(cli: Cli, workspace: Workspace): VaultState {
  workspace.state = fold([...workspace.events, ...workspace.pending], cli.time)
  return workspace.state
}

export function stage(
  cli: Cli,
  workspace: Workspace,
  type: Parameters<typeof makeEvent>[0],
  data: Record<string, unknown>,
): EventEnvelope {
  const event = makeEvent(type, data, { source: cli.source, ts: toISO(cli.now) })
  workspace.pending.push(event)
  refold(cli, workspace)
  return event
}

export function commit(cli: Cli, workspace: Workspace): EventEnvelope[] {
  if (!cli.dryRun) appendEvents(cli.vault.eventsFile, workspace.pending)
  return workspace.pending
}

export type GameQuery = ResolveOptions & {
  /** `--no-metadata`: create a local-only entry from the raw string. */
  metadata?: boolean
  /**
   * Whether an unmatched query may open a new entry. True for the commands that
   * bring a game into the register (`start`, `past`); false for the ones that
   * act on something already there (`end`, `finish`, `alias`).
   */
  allowCreate?: boolean
}

export function ambiguousError(query: string, candidates: readonly Candidate[], truncated: boolean): GameregError {
  return new GameregError(
    'ambiguous',
    'error.ambiguous',
    { query, count: candidates.length },
    { details: { query, candidates, ...(truncated ? { truncated: true } : {}) } },
  )
}

function createGame(
  cli: Cli,
  workspace: Workspace,
  title: string,
  providers: Record<string, string> = {},
): GameState {
  const taken = new Set(workspace.state.games.map((game) => game.slug))
  const gameId = newId()
  stage(cli, workspace, 'game.create', {
    game_id: gameId,
    slug: uniqueSlug(title, taken),
    title,
    genres: [],
    platforms: [],
    providers,
    aliases: [],
  })
  const game = workspace.state.gamesById.get(gameId)
  if (game === undefined) throw new GameregError('error', 'error.unexpected', { message: gameId })
  return game
}

/**
 * Every resolution teaches: when a query was answered by an explicit `--id` or
 * by the menu, the normalized query is filed as an alias and never asked again.
 */
function learnAlias(cli: Cli, workspace: Workspace, game: GameState, query: string | null): void {
  if (query === null) return
  const alias = normalize(query)
  if (alias === '' || alias === normalize(game.title)) return
  if (game.aliases.some((known) => normalize(known) === alias)) return
  stage(cli, workspace, 'game.alias', { game_id: game.game_id, alias })
}

/**
 * Resolution plus presentation. Ambiguity is returned as exit code 3 to a
 * machine and as a menu to a human — from the same candidate array.
 */
export async function resolveGame(
  cli: Cli,
  workspace: Workspace,
  query: string | null,
  options: GameQuery = {},
): Promise<GameState> {
  const resolution = resolveLocal(workspace.state, query, {
    ...options,
    platforms: platformTable(cli.vault.config.platforms),
  })

  if (resolution.kind === 'resolved') {
    if (options.id !== undefined && options.id !== null) learnAlias(cli, workspace, resolution.game, query)
    return resolution.game
  }

  const title = (query ?? '').trim()
  const allowCreate = options.allowCreate === true

  if (resolution.kind === 'ambiguous') {
    if (!cli.interactive) throw ambiguousError(title, resolution.candidates, resolution.truncated)
    const choice = await choose(cli, title, resolution.candidates, allowCreate)
    if (choice.kind === 'create') return createGame(cli, workspace, title)
    return resolveGame(cli, workspace, query, { ...options, id: choice.ref })
  }

  if (options.id !== undefined && options.id !== null) {
    // A provider ref with no local match yet is trusted, never searched: the
    // caller already resolved it (a `search` hit, or a human picking a
    // provider candidate from a code-3 menu). No network call here — that
    // would break invariant 5 — so the game is created from the ref alone,
    // titled from the query the caller still had to pass, and `enrich`
    // fills in the rest later from the id already on record. A `game:`
    // reference gets no such leniency: that ULID was supposed to exist.
    const reference = parseReference(options.id)
    if (reference !== null && reference.kind === 'provider' && allowCreate && title !== '') {
      return createGame(cli, workspace, title, { [reference.provider]: reference.id })
    }
    throw new GameregError('not_found', 'error.unknown_id', { ref: options.id })
  }
  if (title === '' || !allowCreate) {
    throw new GameregError(
      'not_found',
      'error.not_found',
      { query: title },
      { details: { query: title, candidates: [] } },
    )
  }

  // Nothing on record. `--no-metadata` creates outright; a human is offered the
  // same thing as a one-item menu; a machine gets exit 4 and the hint.
  if (options.metadata === false) return createGame(cli, workspace, title)
  if (cli.interactive) {
    const choice = await choose(cli, title, [], true)
    if (choice.kind === 'create') return createGame(cli, workspace, title)
  }
  throw new GameregError(
    'not_found',
    'error.not_found_hint',
    { query: title },
    { details: { query: title, candidates: [] } },
  )
}

export type RunDefaults = {
  platform: string | null
  /** Null exactly when `platform` is. */
  platform_source: PlatformSource | null
  form: Form
  mode: Mode
}

/**
 * `run.open` takes platform, form and mode; `start` is usually typed without
 * them. Flag → last run of this game → config → a single-member catalog
 * intersection.
 *
 * When none of those answer, the run is recorded **without** a platform rather
 * than with a guessed one (docs/spec/02-cli.md): starting to play is the one
 * moment where a question is pure friction, and the moment when the answer is
 * least informed — the game may not have been enriched yet. `end`, `finish`
 * and `drop` settle it later, with the catalog in hand.
 */
export function runDefaults(
  cli: Cli,
  game: GameState,
  options: { platform?: string; form?: string; mode?: string },
): RunDefaults {
  const last = game.runs.at(-1)
  const table = platformTable(cli.vault.config.platforms)

  const resolved = ((): { platform: string | null; source: PlatformSource | null } => {
    const flag = canonicalPlatform(options.platform, table)
    if (flag !== null) return { platform: flag, source: 'flag' }
    const previous = canonicalPlatform(last?.platform, table)
    if (previous !== null) return { platform: previous, source: 'last_run' }
    const configured = canonicalPlatform(cli.vault.config.defaults.platform, table)
    if (configured !== null) return { platform: configured, source: 'config_default' }
    const sole = soleMatch(platformGroups(game, table))
    if (sole !== null) return { platform: sole, source: 'intersection' }
    return { platform: null, source: null }
  })()

  return {
    platform: resolved.platform,
    platform_source: resolved.source,
    form:
      options.form === undefined
        ? (last?.form ?? cli.vault.config.defaults.form)
        : checkEnum('form', options.form, FORM),
    mode:
      options.mode === undefined
        ? (last?.mode ?? cli.vault.config.defaults.mode)
        : checkEnum('mode', options.mode, MODE),
  }
}

export type NewRunOptions = {
  platform?: string
  form?: string
  mode?: string
  /** Stated baseline, as typed (e.g. `"30"`) — `start --past-hours` or `past` without `--ended`. */
  hours?: string
  /** Defaults to today, day precision — `start`'s own case. `past` passes an explicit guess. */
  startedOn?: string
  startedPrecision?: DatePrecision
}

export type NewRun = {
  run_id: string
  platform_source: PlatformSource | null
}

/**
 * Stages a `run.open` for an already-resolved game — the mechanics `start`
 * and `past` (filed without `--ended`) share. Never stages a `session.open`;
 * that decision belongs to the caller. `start` always opens one right after
 * calling this. `past` never does — "estou jogando X, já tenho 30h" is a
 * fact about an ongoing run, not an announcement that a session is starting
 * this instant (05-agent.md, *Starting*).
 */
export function stageNewRun(cli: Cli, workspace: Workspace, game: GameState, options: NewRunOptions): NewRun {
  const defaults = runDefaults(cli, game, options)
  const runId = newId()
  const hours = options.hours === undefined ? null : hoursToMinutes(Number(options.hours)) / 60
  const precision = options.startedPrecision ?? 'day'
  stage(cli, workspace, 'run.open', {
    run_id: runId,
    game_id: game.game_id,
    ...(defaults.platform === null ? {} : { platform: defaults.platform }),
    form: defaults.form,
    mode: defaults.mode,
    started_on: options.startedOn ?? logicalDay(cli.at, cli.vault.config.day_cutoff),
    ...(precision === 'day' ? {} : { date_precision: precision }),
    replay: game.runs.length > 0,
    ...(hours === null ? {} : { hours }),
  })
  return { run_id: runId, platform_source: defaults.platform_source }
}

export function openRunOf(game: GameState): RunState | null {
  return game.runs.find((run) => run.open) ?? null
}

export function openSessionOf(run: RunState): SessionState | null {
  return run.sessions.find((session) => session.open) ?? null
}

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

export function gameOfSession(state: VaultState, session: SessionState): GameState {
  const run = state.runsById.get(session.run_id)
  const game = run === undefined ? undefined : state.gamesById.get(run.game_id)
  if (game === undefined) throw new GameregError('error', 'error.unexpected', { message: session.session_id })
  return game
}

/** The open session this command acts on: named, implied, or ambiguous (code 3). */
export async function targetSession(
  cli: Cli,
  workspace: Workspace,
  query: string | null,
  options: GameQuery,
): Promise<SessionState> {
  const named = query !== null || (options.id !== undefined && options.id !== null)

  if (named) {
    const game = await resolveGame(cli, workspace, query, { ...options, allowCreate: false })
    const run = openRunOf(game)
    const session = run === null ? null : openSessionOf(run)
    if (session === null) {
      throw new GameregError('conflict', 'error.no_open_session_for', { title: game.title })
    }
    return session
  }

  const sessions = openSessions(workspace.state)
  const only = sessions[0]
  if (only === undefined) throw new GameregError('conflict', 'error.no_open_session')
  if (sessions.length === 1) return only

  const candidates = sessions.map((session) => candidateOf(gameOfSession(workspace.state, session)))
  if (!cli.interactive) {
    throw new GameregError(
      'ambiguous',
      'error.several_open_sessions',
      { count: sessions.length },
      { details: { candidates } },
    )
  }
  const choice = await choose(cli, '', candidates, false)
  if (choice.kind !== 'candidate') throw new GameregError('usage', 'prompt.cancelled')
  const picked = sessions.find(
    (session) => `game:${gameOfSession(workspace.state, session).game_id}` === choice.ref,
  )
  if (picked === undefined) throw new GameregError('conflict', 'error.no_open_session')
  return picked
}
