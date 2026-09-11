/**
 * `gamereg doctor` — validate the log. Reports; does not fix.
 *
 * Unknown enums, sessions closing before they open, runs closed twice, orphan
 * references, breaks outside sessions, slug collisions. Exit 1 if anything is
 * wrong.
 */
import type { Command } from 'commander'

import { readLog } from '../../core/events.ts'
import { fold, type FoldProblem } from '../../core/fold.ts'
import {
  checkEnum,
  COMPLETION_CRITERIA,
  DIFFICULTY,
  FORM,
  MODE,
  OUTCOME,
  RATING_MAX,
  CHECKIN_OUTCOME,
  RATING_MIN,
} from '../../core/vocab.ts'
import { GameregError } from '../../core/errors.ts'
import { translator } from '../../i18n/index.ts'
import { auditArtifacts } from '../../targets/audit.ts'
import { createContext } from '../context.ts'
import { emit, emitFailure } from '../output.ts'
import type { EventType } from '../../core/events.ts'
import type { Registrar } from '../register.ts'

/**
 * Checked against the payload as written, for every event that carries the
 * field. `only` narrows an entry to one event type, which `outcome` needs:
 * `session.checkin` spends the same field name on a different closed list
 * (`CHECKIN_OUTCOME`), so a flat table reports every check-in ever filed as
 * invalid — eleven of them here before this was noticed, which is eleven
 * false positives hiding whatever is real.
 */
const ENUM_FIELDS = [
  { field: 'outcome', vocabulary: CHECKIN_OUTCOME, only: 'session.checkin' },
  { field: 'outcome', vocabulary: OUTCOME, except: 'session.checkin' },
  { field: 'completion_criteria', vocabulary: COMPLETION_CRITERIA },
  { field: 'difficulty', vocabulary: DIFFICULTY },
  { field: 'form', vocabulary: FORM },
  { field: 'mode', vocabulary: MODE },
] as const satisfies readonly {
  field: string
  vocabulary: readonly string[]
  only?: EventType
  except?: EventType
}[]

export function registerDoctor(registrar: Registrar): void {
  registrar.command('doctor', 'help.doctor').action(async (options: unknown, command: Command) => {
    const cli = createContext(command)
    void options

    const { events, problems: unreadable } = readLog(cli.vault.eventsFile)
    const state = fold(events, cli.time)
    const problems: FoldProblem[] = [...state.problems]

    for (const problem of unreadable) {
      problems.unshift({ key: problem.key, params: { ...problem.params, line: problem.line }, event_id: null })
    }

    // Vocabulary and range checks, on the payloads as written.
    for (const event of events) {
      for (const entry of ENUM_FIELDS) {
        const { field, vocabulary } = entry
        const only = 'only' in entry ? entry.only : undefined
        const except = 'except' in entry ? entry.except : undefined
        if (only !== undefined && event.type !== only) continue
        if (except !== undefined && event.type === except) continue
        const value = event.data[field]
        if (typeof value !== 'string') continue
        try {
          checkEnum(field, value, vocabulary)
        } catch (error) {
          if (!(error instanceof GameregError)) throw error
          problems.push({ key: error.key, params: error.params, event_id: event.id })
        }
      }
      const rating = event.data['rating']
      if (rating !== undefined && rating !== null) {
        const invalid =
          typeof rating !== 'number' || !Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX
        if (invalid) {
          problems.push({
            key: 'error.rating',
            params: { value: String(rating), min: RATING_MIN, max: RATING_MAX },
            event_id: event.id,
          })
        }
      }
    }

    // The derived side: unknown blocks, prose about to be lost, orphans, and
    // two targets claiming one path. Reports; the build stays out of it.
    problems.push(...auditArtifacts(cli.vault, state, translator(cli.locale)))

    const bySlug = new Map<string, number>()
    for (const game of state.games) bySlug.set(game.slug, (bySlug.get(game.slug) ?? 0) + 1)
    for (const [slug, count] of bySlug) {
      if (count > 1) problems.push({ key: 'doctor.slug_collision', params: { slug, count }, event_id: null })
    }

    const described = problems.map((problem) => ({
      message: cli.t(problem.key, problem.params),
      key: problem.key,
      event_id: problem.event_id,
      ...problem.params,
    }))

    if (described.length === 0) {
      emit(cli, {
        action: 'doctor',
        result: {
          events: events.length,
          games: state.games.length,
          runs: state.runsById.size,
          problems: [],
        },
        events: [],
        prose: [
          cli.t('prose.doctor.clean', {
            events: events.length,
            games: state.games.length,
            runs: state.runsById.size,
          }),
        ],
      })
      return
    }

    if (!cli.json && !cli.quiet) {
      const lines = [
        cli.t('prose.doctor.header', { count: described.length }),
        ...described.map((problem) => cli.t('prose.doctor.line', { message: problem.message })),
      ]
      process.stderr.write(`${lines.join('\n')}\n`)
      process.exitCode = 1
      return
    }

    process.exitCode = emitFailure(
      cli,
      new GameregError(
        'error',
        'prose.doctor.header',
        { count: described.length },
        { details: { problems: described } },
      ),
    )
  })
}
