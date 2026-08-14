/**
 * Building `data/log.db` from folded state (docs/spec/04-derived.md "SQLite").
 *
 * `node:sqlite` has no in-memory serialize; the only way to get bytes out of a
 * `DatabaseSync` is to point it at a real file and read it back. That file
 * lives in a throwaway temp directory for the lifetime of one build and never
 * touches the vault — the target itself still reads nothing but the folded
 * state and the config, and the bytes it returns are fully determined by them.
 *
 * Rebuilt from scratch every time, never incrementally (07-targets.md
 * "sqlite"): same state in, same bytes out, so a fixed page size and a fixed
 * insertion order are what make the file byte-comparable across builds.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { GameState, RunState, SessionState, VaultState } from '../core/fold.ts'
import { SCHEMA_SQL } from './schema.ts'

function byKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const a = key(left)
    const b = key(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

export function buildDatabase(state: VaultState): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'gamereg-sqlite-'))
  const file = join(dir, 'log.db')

  try {
    const db = new DatabaseSync(file)
    try {
      // page_size can only be set before the first table exists.
      db.exec('PRAGMA page_size = 4096;')
      db.exec(SCHEMA_SQL)

      const games = byKey(state.games, (game: GameState) => game.slug)
      const runs = byKey(
        state.games.flatMap((game) => game.runs),
        (run: RunState) => `${run.started_on}|${run.run_id}`,
      )
      const sessions = byKey(
        state.games.flatMap((game) => game.runs.flatMap((run) => run.sessions)),
        (session: SessionState) => `${session.started_at}|${session.session_id}`,
      )
      const breaks = byKey(
        sessions.flatMap((session) => session.breaks),
        (brk) => `${brk.started_at}|${brk.break_id}`,
      )
      const events = byKey([...state.eventsById.values()], (event) => event.id)

      const insertGame = db.prepare(
        'INSERT INTO games (game_id, slug, title, release_year, developer, publisher, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      const insertPlatform = db.prepare('INSERT INTO game_platforms (game_id, platform) VALUES (?, ?)')
      const insertGenre = db.prepare('INSERT INTO game_genres (game_id, genre) VALUES (?, ?)')
      const insertAlias = db.prepare('INSERT INTO aliases (game_id, alias) VALUES (?, ?)')
      for (const game of games) {
        insertGame.run(
          game.game_id,
          game.slug,
          game.title,
          game.release_year,
          game.developer,
          game.publisher,
          game.status,
        )
        for (const platform of game.platforms) insertPlatform.run(game.game_id, platform)
        for (const genre of game.genres) insertGenre.run(game.game_id, genre)
        for (const alias of game.aliases) insertAlias.run(game.game_id, alias)
      }

      const insertRun = db.prepare(
        `INSERT INTO runs (run_id, game_id, platform, platform_raw, form, mode, started_on, ended_on,
           outcome, completion_criteria, rating, difficulty, minutes, hours_source, replay)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const run of runs) {
        insertRun.run(
          run.run_id,
          run.game_id,
          run.platform,
          run.platform_raw,
          run.form,
          run.mode,
          run.started_on,
          run.ended_on,
          run.outcome,
          run.completion_criteria,
          run.rating,
          run.difficulty,
          run.minutes,
          run.hours_source,
          run.replay ? 1 : 0,
        )
      }

      const insertSession = db.prepare(
        'INSERT INTO sessions (session_id, run_id, started_at, ended_at, minutes, logical_day, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      for (const session of sessions) {
        insertSession.run(
          session.session_id,
          session.run_id,
          session.started_at,
          session.ended_at,
          session.minutes,
          session.logical_day,
          session.note,
        )
      }

      const insertBreak = db.prepare(
        'INSERT INTO breaks (break_id, session_id, started_at, ended_at, minutes) VALUES (?, ?, ?, ?, ?)',
      )
      for (const brk of breaks) {
        insertBreak.run(brk.break_id, brk.session_id, brk.started_at, brk.ended_at, brk.minutes)
      }

      const insertEvent = db.prepare('INSERT INTO events (event_id, ts, type, source, payload) VALUES (?, ?, ?, ?, ?)')
      for (const event of events) {
        insertEvent.run(event.id, event.ts, event.type, event.source, JSON.stringify(event.data))
      }
    } finally {
      db.close()
    }

    return readFileSync(file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
