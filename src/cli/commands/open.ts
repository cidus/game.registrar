/** `gamereg open` — list open sessions. Never writes. */
import type { Command } from 'commander'

import { formatHm, minutesBetween } from '../../core/duration.ts'
import { parseISO } from '../../core/time.ts'
import { createContext } from '../context.ts'
import { clockOf } from '../format.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { gameOfSession, load, openSessions } from '../workspace.ts'

export function registerOpen(registrar: Registrar): void {
  registrar.command('open', 'help.open').action(async (options: unknown, command: Command) => {
    const cli = createContext(command)
    const workspace = load(cli)
    void options

    const rows = openSessions(workspace.state).map((session) => {
      const game = gameOfSession(workspace.state, session)
      const run = workspace.state.runsById.get(session.run_id)
      const openFor = minutesBetween(parseISO(session.started_at, cli.time), cli.at)
      const running = session.breaks.find((item) => item.open)
      const breakMinutes = session.breaks.reduce(
        (total, item) =>
          total +
          (item.open ? Math.max(0, minutesBetween(parseISO(item.started_at, cli.time), cli.at)) : item.minutes),
        0,
      )
      return {
        session_id: session.session_id,
        run_id: session.run_id,
        game: game.title,
        game_id: game.game_id,
        opened_at: session.started_at,
        open_for_minutes: Math.max(0, openFor),
        net_minutes: Math.max(0, openFor - breakMinutes),
        on_break: running !== undefined,
        break_started_at: running?.started_at ?? null,
        checkins_so_far: session.checkins.length,
        // The two event ids an `amend` or a `revoke` actually takes. Entity
        // ids (`session_id`, `run_id`) are not interchangeable with them, and
        // before these were on the row the only way to an event id was raw SQL
        // over `events` with `json_extract` — which cost a `query --schema`, a
        // guessed column, and a retry, every time.
        session_open_event_id: session.open_event_id,
        run_open_event_id: run?.open_event_id ?? null,
        // The check-in the agent may have to amend. The wrapper files the
        // record *after* enqueueing the wake, so the id cannot travel with the
        // question itself (docs/spec/02-cli.md, `gamereg checkin`); this is how
        // the answer, when it arrives, finds the record it settles. Read it
        // before closing the session — a closed session is not listed here.
        last_checkin_id: session.checkins.at(-1)?.event_id ?? null,
      }
    })

    const prose =
      rows.length === 0
        ? [cli.t('prose.open.none')]
        : rows.map((row) =>
            row.break_started_at === null
              ? cli.t('prose.open.row', {
                  title: row.game,
                  time: clockOf(cli, row.opened_at),
                  duration: formatHm(row.open_for_minutes),
                })
              : cli.t('prose.open.row_break', {
                  title: row.game,
                  time: clockOf(cli, row.opened_at),
                  duration: formatHm(row.open_for_minutes),
                  break_time: clockOf(cli, row.break_started_at),
                }),
          )

    emit(cli, { action: 'open', result: { open: rows }, events: [], prose })
  })
}
