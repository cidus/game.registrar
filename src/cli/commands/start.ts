/**
 * `gamereg start <query>` — open a session (docs/spec/02-cli.md).
 *
 * No network, ever: `run.open` writes what is known locally and `enrich` runs
 * later. A start command must never fail because a provider is down.
 */
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { newId } from '../../core/ids.ts'
import type { PlatformSource } from '../../core/platforms.ts'
import { toISO } from '../../core/time.ts'
import { attachmentProse, attachmentResult, collectAttachments, stageCoverFromFirst, suggestedAtProse } from '../attachments.ts'
import { createContext } from '../context.ts'
import { clock, clockOf, list } from '../format.ts'
import { emit } from '../output.ts'
import { learnPlatform } from '../platform.ts'
import type { Registrar } from '../register.ts'
import {
  commit,
  gameOfSession,
  load,
  openRunOf,
  openSessionOf,
  openSessions,
  resolveGame,
  stage,
  stageNewRun,
} from '../workspace.ts'

type Options = {
  id?: string
  platform?: string
  form?: string
  mode?: string
  replay?: boolean
  pastHours?: string
  metadata?: boolean
  kind?: string
  asCover?: boolean
}

export function registerStart(registrar: Registrar): void {
  registrar
    .command('start', 'help.start')
    .argument('<query>', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--platform <name>', registrar.t('help.opt.platform'))
    .option('--form <form>', registrar.t('help.opt.form'))
    .option('--mode <mode>', registrar.t('help.opt.mode'))
    .option('--replay', registrar.t('help.opt.replay'))
    .option('--past-hours <n>', registrar.t('help.opt.past_hours'))
    .option('--no-metadata', registrar.t('help.opt.no_metadata'))
    .option('--photo <path>', registrar.t('help.opt.photo'))
    .option('--caption <text>', registrar.t('help.opt.caption'))
    .option('--kind <kind>', registrar.t('help.opt.kind'))
    .option('--as-cover', registrar.t('help.opt.as_cover'))
    .action(async (query: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)
      const bundle = await collectAttachments(cli, command, options.kind)

      const resolved = await resolveGame(cli, workspace, query, {
        id: options.id,
        platform: options.platform,
        metadata: options.metadata,
        allowCreate: true,
      })
      const gameId = resolved.game_id
      const created = workspace.pending.some((event) => event.type === 'game.create')

      // State objects are rebuilt by every fold, so read the game back by id.
      const before = workspace.state.gamesById.get(gameId)!

      // A run already open is reused; --replay forces a new one (a certified copy).
      const reusable = options.replay === true ? null : openRunOf(before)
      const alreadyOpen = reusable === null ? null : openSessionOf(reusable)
      if (alreadyOpen !== null) {
        throw new GameregError('conflict', 'error.session_already_open', {
          title: before.title,
          time: clockOf(cli, alreadyOpen.started_at),
        })
      }

      let runId = reusable?.run_id ?? null
      const openedRun = runId === null
      if (!openedRun && options.pastHours !== undefined) {
        // Nothing new to attach a baseline to: the run this would-be session
        // joins already exists. Adjusting its hours is `gamereg amend`'s job.
        throw new GameregError('usage', 'error.past_hours_no_new_run', { title: before.title })
      }
      let platformSource: PlatformSource | null = null
      if (runId === null) {
        const opened = stageNewRun(cli, workspace, before, { ...options, hours: options.pastHours })
        runId = opened.run_id
        platformSource = opened.platform_source
      }

      const sessionId = newId()
      stage(cli, workspace, 'session.open', {
        session_id: sessionId,
        run_id: runId,
        at: toISO(cli.at),
        ...(bundle.attachments.length === 0 ? {} : { attachments: bundle.attachments }),
      })
      if (options.asCover === true) stageCoverFromFirst(cli, workspace, gameId, bundle.photos)

      const events = commit(cli, workspace)
      const game = workspace.state.gamesById.get(gameId)!
      const run = workspace.state.runsById.get(runId)!

      // A platform typed here joins the suggestion list, the same way one
      // typed at a closing prompt does: the list grows from actual use.
      if (platformSource === 'flag') learnPlatform(cli, run.platform)

      // Sessions on *other* games, which `start` never closes: parallel runs are
      // allowed (02-cli.md). Reported as data as well as prose — an agent gets
      // JSON only, and "you are still in a session over there" is the one thing
      // it needs to offer the switch that the user almost always meant.
      const others = openSessions(workspace.state)
        .filter((session) => session.session_id !== sessionId)
        .map((session) => {
          const other = gameOfSession(workspace.state, session)
          return {
            session_id: session.session_id,
            run_id: session.run_id,
            game_id: other.game_id,
            title: other.title,
            started_at: session.started_at,
          }
        })

      // A run with no platform yet says so by omission, not by printing a
      // parenthesised "null" at the user.
      const known = run.platform !== null
      const prose: string[] = []
      if (created) prose.push(cli.t('prose.start.created', { title: game.title }))
      if (openedRun && run.replay) {
        prose.push(
          cli.t(known ? 'prose.start.replay' : 'prose.start.replay_unknown', {
            title: game.title,
            platform: run.platform,
            run: game.runs.length,
            time: clock(cli.at),
          }),
        )
      } else {
        const key = openedRun ? 'prose.start.new_run' : 'prose.start.filed'
        prose.push(
          cli.t(known ? key : `${key}_unknown`, {
            title: game.title,
            platform: run.platform,
            time: clock(cli.at),
          }),
        )
      }
      if (others.length > 0) prose.push(cli.t('prose.start.also_open', { list: list(others.map((o) => o.title)) }))
      if (openedRun && options.pastHours !== undefined) {
        prose.push(cli.t('prose.start.past_hours', { hours: options.pastHours }))
      }
      prose.push(...attachmentProse(cli, bundle.photos, options.asCover === true))
      prose.push(...suggestedAtProse(cli, bundle.suggestedAt))

      emit(cli, {
        action: 'session.open',
        result: {
          game: { game_id: game.game_id, slug: game.slug, title: game.title, created },
          run_id: run.run_id,
          session_id: sessionId,
          at: toISO(cli.at),
          platform: run.platform,
          ...(platformSource === null ? {} : { platform_source: platformSource }),
          form: run.form,
          mode: run.mode,
          replay: run.replay,
          run_opened: openedRun,
          ...(others.length === 0 ? {} : { also_open: others }),
          ...(bundle.photos.length === 0 ? {} : { attachments: bundle.photos.map(attachmentResult) }),
        },
        events,
        prose,
      })
    })
}
