/**
 * Attachments as rows: every photo on record, resolved to the game, run and
 * session it belongs to (docs/spec/04-derived.md "SQLite").
 *
 * `state.attachments` is keyed by *target* — an event id, or a game id — which
 * is what the log carries and not what a consumer asks in. Resolving that key
 * is the one thing standing between a folded attachment and a query, and it
 * lives here rather than in `db/build.ts` because `csv`, `json` and `sqlite`
 * all emit these columns: three copies of this walk would be three chances to
 * disagree, and 04-derived.md says they may not.
 *
 * Nothing here re-reads the log's corrections. `fold` already applied every
 * `event.revoke` and `event.amend` before an attachment reached the map, and
 * that is where that logic stays; this only answers "whose is it".
 */
import type { EventEnvelope } from './events.ts'
import type { Attachment, VaultState } from './fold.ts'
import { filedAtOf } from './fold.ts'

export type AttachmentRow = {
  sha256: string
  ext: string
  kind: string
  caption: string | null
  captured_at: string | null
  /** When it was filed — the same date the game note's gallery prints. */
  filed_at: string
  /** Always known: a session implies a run implies a game. */
  game_id: string
  run_id: string | null
  session_id: string | null
  /** The fold's own key — an event id, or a game id — so an audit can walk back. */
  target: string
}

const str = (data: Record<string, unknown>, key: string): string | null => {
  const value = data[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** The hashes a raw payload carries, for dating a game-level attachment. */
function shasOf(data: Record<string, unknown>): string[] {
  const value = data['attachments']
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const sha256 = str(item as Record<string, unknown>, 'sha256')
    if (sha256 !== null) out.push(sha256)
  }
  return out
}

type Owner = { game_id: string; run_id: string | null; session_id: string | null }

/**
 * The entities an event belongs to, narrowest first. Every id is checked
 * against the fold rather than trusted from the payload, so a dangling
 * reference yields absence and never a row pointing at nothing.
 *
 * An event that resolves to no game contributes nothing. Two shapes reach
 * this: an `attachment.add`, whose payload names a target and no entity — and
 * whose attachments are keyed under that target as well, so they are already
 * counted — and a `break.close`, which carries only a break id the fold could
 * not place. The game note's gallery drops both for the same reason
 * (`gameOfEvent`), and that agreement is the point.
 */
function ownerOf(state: VaultState, event: EventEnvelope): Owner | null {
  const data = event.data
  const breakId = str(data, 'break_id')
  const sessionId =
    str(data, 'session_id') ?? (breakId === null ? null : (state.breaksById.get(breakId)?.session_id ?? null))
  const session = sessionId === null ? null : (state.sessionsById.get(sessionId) ?? null)
  const runId = session?.run_id ?? str(data, 'run_id')
  const run = runId === null ? null : (state.runsById.get(runId) ?? null)
  const gameId = run?.game_id ?? str(data, 'game_id')
  const game = gameId === null ? null : (state.gamesById.get(gameId) ?? null)
  if (game === null) return null
  return { game_id: game.game_id, run_id: run?.run_id ?? null, session_id: session?.session_id ?? null }
}

/**
 * One row per `(target, sha256)`, chronological by `filed_at`, ties broken by
 * target and then hash.
 *
 * The same photo under two targets is two rows on purpose — a photo attached
 * to a session and then promoted to the game's cover is filed twice — and a
 * consumer building a gallery de-duplicates on `sha256` itself, which is what
 * the game note already does.
 */
export function attachmentRows(state: VaultState): AttachmentRow[] {
  // Filing dates for the game-keyed entries. The entries themselves come from
  // the fold, which is correction-aware; only the date has to come back out of
  // a raw payload, because a game id names no moment. By hash, as the gallery
  // does, and by target as a fallback so `filed_at` is never empty here.
  const byHash = new Map<string, string>()
  const byTarget = new Map<string, string>()
  for (const event of state.eventsById.values()) {
    if (event.type !== 'attachment.add') continue
    const target = str(event.data, 'target')
    if (target === null || !state.gamesById.has(target)) continue
    if (!byTarget.has(target)) byTarget.set(target, event.ts)
    for (const sha256 of shasOf(event.data)) {
      const key = `${target} ${sha256}`
      if (!byHash.has(key)) byHash.set(key, event.ts)
    }
  }

  const rows: AttachmentRow[] = []
  const push = (target: string, attachment: Attachment, filedAt: string, owner: Owner): void => {
    rows.push({
      sha256: attachment.sha256,
      ext: attachment.ext,
      kind: attachment.kind,
      caption: attachment.caption,
      captured_at: attachment.captured_at,
      filed_at: filedAt,
      game_id: owner.game_id,
      run_id: owner.run_id,
      session_id: owner.session_id,
      target,
    })
  }

  for (const [target, attachments] of state.attachments) {
    const event = state.eventsById.get(target)
    if (event !== undefined) {
      const owner = ownerOf(state, event)
      if (owner === null) continue
      const filedAt = filedAtOf(event)
      for (const attachment of attachments) push(target, attachment, filedAt, owner)
      continue
    }
    const game = state.gamesById.get(target)
    if (game === undefined) continue
    for (const attachment of attachments) {
      const filedAt = byHash.get(`${target} ${attachment.sha256}`) ?? byTarget.get(target) ?? ''
      push(target, attachment, filedAt, { game_id: game.game_id, run_id: null, session_id: null })
    }
  }

  return rows.sort((left, right) => {
    const key = `${left.filed_at}|${left.target}|${left.sha256}`
    const other = `${right.filed_at}|${right.target}|${right.sha256}`
    return key < other ? -1 : key > other ? 1 : 0
  })
}
