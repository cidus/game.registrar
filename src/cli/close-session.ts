/**
 * Closing a session, shared by `end`, `finish` and `drop`.
 *
 * The arithmetic is validated *before* the event is written: a negative
 * duration is rejected, never clamped (docs/spec/01-model.md "Duration").
 */
import type { DateTime } from 'luxon'

import { minutesBetween, parseDuration } from '../core/duration.ts'
import { GameregError } from '../core/errors.ts'
import type { Attachment, SessionState } from '../core/fold.ts'
import { parseISO, toISO } from '../core/time.ts'
import type { Cli } from './context.ts'
import { stage, type Workspace } from './workspace.ts'

export type CloseInput = {
  at: DateTime
  /** `--break 40m`, additive with logged breaks. */
  breakText?: string | undefined
  note?: string | undefined
  /** `--photo` on `end`. Never populated when auto-closing from `finish`/`drop`. */
  attachments?: readonly Attachment[] | undefined
}

export type CloseResult = {
  minutes: number
  breakMinutes: number
}

export function closeSession(
  cli: Cli,
  workspace: Workspace,
  session: SessionState,
  input: CloseInput,
): CloseResult {
  const openedAt = parseISO(session.started_at, cli.time)
  const gross = minutesBetween(openedAt, input.at)
  if (gross < 0) throw new GameregError('usage', 'error.negative_duration')

  const declared = input.breakText === undefined ? 0 : parseDuration(input.breakText)

  // A break still open is closed at the same instant the session is.
  let logged = 0
  for (const item of session.breaks) {
    if (item.open) {
      const started = parseISO(item.started_at, cli.time)
      logged += Math.max(0, minutesBetween(started, input.at))
    } else {
      logged += item.minutes
    }
  }

  const net = gross - logged - declared
  if (net < 0) throw new GameregError('usage', 'error.negative_duration')

  stage(cli, workspace, 'session.close', {
    session_id: session.session_id,
    at: toISO(input.at),
    ...(declared > 0 ? { break_minutes: declared } : {}),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.attachments === undefined || input.attachments.length === 0 ? {} : { attachments: input.attachments }),
  })

  return { minutes: net, breakMinutes: logged + declared }
}
