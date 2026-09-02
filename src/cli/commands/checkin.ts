/**
 * `gamereg checkin <session_id> --trigger <t> [--outcome <o>]`
 * `gamereg checkin --expire`
 *
 * Files that a question was asked, and later that nobody answered it. Called
 * by the cron wrapper, never by the agent: the anti-nagging rules are a clock
 * and a counter, and a chat turn cannot keep a promise 45 minutes after the
 * fact (docs/spec/05-agent.md, *Anti-nagging rules*).
 *
 * A check-in never mutates the session. If the user says they are stopping,
 * that is a `session.close` and a separate command — this one only records
 * that they were asked.
 */
import type { Command } from 'commander'

import { staleCheckins } from '../../core/due.ts'
import { GameregError } from '../../core/errors.ts'
import { toISO } from '../../core/time.ts'
import { CHECKIN_OUTCOME, CHECKIN_TRIGGER, checkEnum } from '../../core/vocab.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, load, stage } from '../workspace.ts'

type Options = { trigger?: string; outcome?: string; expire?: boolean }

/**
 * The reason written into the amend. A token rather than a sentence: it lands
 * in the log, which is data and has no locale, and nothing downstream should
 * ever be tempted to show it to anyone as prose.
 */
const EXPIRY_REASON = 'reply_window_elapsed'

export function registerCheckin(registrar: Registrar): void {
  registrar
    .command('checkin', 'help.checkin')
    .argument('[session_id]', registrar.t('help.arg.session'))
    .option('--trigger <trigger>', registrar.t('help.opt.trigger'))
    .option('--outcome <outcome>', registrar.t('help.opt.checkin_outcome'))
    .option('--expire', registrar.t('help.opt.expire'))
    .action(async (sessionId: string | undefined, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      if (options.expire === true) {
        if (sessionId !== undefined || options.trigger !== undefined || options.outcome !== undefined) {
          throw new GameregError('usage', 'error.expire_takes_no_session')
        }

        const stale = staleCheckins(workspace.state, cli.vault.config, cli.at, cli.time)
        for (const record of stale) {
          stage(cli, workspace, 'event.amend', {
            target: record.event_id,
            reason: EXPIRY_REASON,
            patch: { outcome: 'no_reply' },
          })
        }
        const events = commit(cli, workspace)

        emit(cli, {
          action: 'checkin.expire',
          result: { expired: stale },
          events,
          prose: [
            stale.length === 0
              ? cli.t('prose.checkin.none_expired')
              : cli.t('prose.checkin.expired', { count: stale.length }),
          ],
        })
        return
      }

      if (sessionId === undefined) throw new GameregError('usage', 'error.checkin_needs_session')
      if (options.trigger === undefined) throw new GameregError('usage', 'error.checkin_needs_trigger')

      const trigger = checkEnum('trigger', options.trigger, CHECKIN_TRIGGER)
      // Defaults to `snoozed` because that is the only outcome the wrapper is
      // ever in a position to know: it files this immediately after enqueueing
      // the wake, and the answer — if one comes — arrives later as an amend.
      const outcome = checkEnum('outcome', options.outcome ?? 'snoozed', CHECKIN_OUTCOME)

      const session = workspace.state.sessionsById.get(sessionId)
      if (session === undefined) {
        throw new GameregError('not_found', 'error.unknown_session', { id: sessionId })
      }

      // A session that closed between the wake and this call is not an error.
      // The question was asked; refusing to record it would lose the fact and
      // leave the session eligible again on the next tick, which is the one
      // direction this feature must not fail in.
      const at = toISO(cli.at)
      const event = stage(cli, workspace, 'session.checkin', {
        session_id: sessionId,
        at,
        trigger,
        outcome,
      })
      const events = commit(cli, workspace)

      emit(cli, {
        action: 'session.checkin',
        result: { session_id: sessionId, checkin_id: event.id, at, trigger, outcome },
        events,
        prose: [cli.t('prose.checkin.filed', { trigger: cli.t(`prose.due.trigger.${trigger}`) })],
      })
    })
}
