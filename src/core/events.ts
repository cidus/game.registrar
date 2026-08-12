/**
 * The event log: envelope, JSONL read and append (docs/spec/01-model.md).
 *
 * Invariant 1: this file only ever grows. Nothing here rewrites or removes a
 * line — `appendEvents` is the single write path, and it opens in append mode.
 */
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, closeSync, fstatSync, readSync } from 'node:fs'
import { dirname } from 'node:path'

import { GameregError } from './errors.ts'
import { newId } from './ids.ts'
import type { EventSource } from './vocab.ts'

export const SCHEMA_VERSION = 1

export const EVENT_TYPES = [
  'game.create',
  'game.alias',
  'game.rename',
  'game.enrich',
  'game.cover',
  'run.open',
  'run.close',
  'run.import',
  'run.verdict',
  'session.open',
  'session.close',
  'break.open',
  'break.close',
  'session.checkin',
  'attachment.add',
  'event.amend',
  'event.revoke',
  'person.create',
  'play.record',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type EventData = Record<string, unknown>

export type EventEnvelope = {
  id: string
  ts: string
  type: EventType
  source: EventSource
  schema: number
  data: EventData
}

export type MakeEventOptions = {
  source?: EventSource
  /** When the event was *recorded*. Semantic times live in `data.at`. */
  ts?: string
}

export function makeEvent(
  type: EventType,
  data: EventData,
  options: MakeEventOptions = {},
): EventEnvelope {
  return {
    id: newId(),
    ts: options.ts ?? new Date().toISOString(),
    type,
    source: options.source ?? 'cli',
    schema: SCHEMA_VERSION,
    data,
  }
}

/** Key order is fixed so the log reads the same everywhere and diffs stay tidy. */
export function serializeEvent(event: EventEnvelope): string {
  return JSON.stringify({
    id: event.id,
    ts: event.ts,
    type: event.type,
    source: event.source,
    schema: event.schema,
    data: event.data,
  })
}

export type LogProblem = {
  line: number
  key: string
  params: Record<string, unknown>
}

export type LogReadResult = {
  events: EventEnvelope[]
  problems: LogProblem[]
}

function parseLine(raw: string, line: number, out: LogReadResult): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    out.problems.push({ line, key: 'doctor.unparseable_line', params: {} })
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    out.problems.push({ line, key: 'doctor.not_an_object', params: {} })
    return
  }
  const record = parsed as Record<string, unknown>
  const id = record['id']
  const ts = record['ts']
  const type = record['type']
  const source = record['source']
  const data = record['data']

  if (typeof id !== 'string' || typeof ts !== 'string' || typeof type !== 'string') {
    out.problems.push({ line, key: 'doctor.missing_envelope_field', params: {} })
    return
  }
  if (!(EVENT_TYPES as readonly string[]).includes(type)) {
    out.problems.push({ line, key: 'doctor.unknown_event_type', params: { type } })
    return
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    out.problems.push({ line, key: 'doctor.bad_payload', params: { id } })
    return
  }

  out.events.push({
    id,
    ts,
    type: type as EventType,
    source: (typeof source === 'string' ? source : 'cli') as EventSource,
    schema: typeof record['schema'] === 'number' ? (record['schema'] as number) : SCHEMA_VERSION,
    data: data as EventData,
  })
}

/**
 * Tolerant read: malformed lines are reported, not thrown, so `doctor` can
 * describe every problem in one pass instead of stopping at the first.
 */
export function readLog(file: string): LogReadResult {
  const out: LogReadResult = { events: [], problems: [] }
  if (!existsSync(file)) return out

  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  for (const [index, raw] of lines.entries()) {
    if (raw.trim() === '') continue
    parseLine(raw, index + 1, out)
  }
  return out
}

/** Strict read, for every command that is about to compute state from the log. */
export function readEvents(file: string): EventEnvelope[] {
  const { events, problems } = readLog(file)
  const first = problems[0]
  if (first !== undefined) {
    throw new GameregError('error', 'error.corrupt_log', { file, line: first.line })
  }
  return events
}

function endsWithNewline(file: string): boolean {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    if (size === 0) return true
    const buffer = Buffer.alloc(1)
    readSync(fd, buffer, 0, 1, size - 1)
    return buffer[0] === 0x0a
  } finally {
    closeSync(fd)
  }
}

/**
 * Appends events as JSONL, LF endings, one syscall. Repairs a missing trailing
 * newline first so a half-written previous line can never absorb a new one.
 */
export function appendEvents(file: string, events: readonly EventEnvelope[]): void {
  if (events.length === 0) return
  mkdirSync(dirname(file), { recursive: true })

  let payload = ''
  if (existsSync(file) && !endsWithNewline(file)) payload += '\n'
  payload += events.map(serializeEvent).join('\n') + '\n'

  appendFileSync(file, payload, { encoding: 'utf8' })
}
