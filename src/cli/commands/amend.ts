/**
 * `gamereg amend <event_id> --reason "..." --set k=v`
 * `gamereg revoke <event_id> --reason "..."`
 *
 * Both append. Neither touches the original line — there is no delete, ever.
 */
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { canonicalPlatform, platformTable } from '../../core/platforms.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import type { Cli } from '../context.ts'
import { commit, load, stage } from '../workspace.ts'

type AmendOptions = { reason?: string; set?: string[] }
type RevokeOptions = { reason?: string }

/**
 * `--set rating=9` yields a number; `--set note=hello` yields a string.
 *
 * `platform` is special-cased through `canonicalPlatform()`, the same
 * boundary every other `--platform` input goes through (02-cli.md, *Platform
 * vocabulary*): `amend` is the documented fix path for a wrong platform
 * inference, and a patch that skipped canonicalization would leave the log
 * holding whatever spelling was typed instead of data clean at rest.
 */
function parsePatch(cli: Cli, pairs: readonly string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const table = platformTable(cli.vault.config.platforms)
  for (const pair of pairs) {
    const index = pair.indexOf('=')
    if (index <= 0) throw new GameregError('usage', 'error.amend_needs_set')
    const key = pair.slice(0, index)
    const raw = pair.slice(index + 1)
    if (key === 'platform') {
      patch[key] = canonicalPlatform(raw, table)
      continue
    }
    try {
      patch[key] = JSON.parse(raw)
    } catch {
      patch[key] = raw
    }
  }
  return patch
}

export function registerAmend(registrar: Registrar): void {
  registrar
    .command('amend', 'help.amend')
    .argument('<event_id>', registrar.t('help.arg.event'))
    .requiredOption('--reason <text>', registrar.t('help.opt.reason'))
    .option('--set <pair...>', registrar.t('help.opt.set'))
    .action(async (eventId: string, options: AmendOptions, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const target = workspace.state.eventsById.get(eventId)
      if (target === undefined) {
        throw new GameregError('not_found', 'error.unknown_event', { id: eventId })
      }
      if (target.type === 'event.amend' || target.type === 'event.revoke') {
        throw new GameregError('usage', 'error.cannot_amend_correction')
      }
      const pairs = options.set ?? []
      if (pairs.length === 0) throw new GameregError('usage', 'error.amend_needs_set')

      const patch = parsePatch(cli, pairs)
      stage(cli, workspace, 'event.amend', { target: eventId, reason: options.reason, patch })
      const events = commit(cli, workspace)

      emit(cli, {
        action: 'event.amend',
        result: { target: eventId, target_type: target.type, patch },
        events,
        prose: [cli.t('prose.amend.done', { id: eventId })],
      })
    })

  registrar
    .command('revoke', 'help.revoke')
    .argument('<event_id>', registrar.t('help.arg.event'))
    .requiredOption('--reason <text>', registrar.t('help.opt.reason'))
    .action(async (eventId: string, options: RevokeOptions, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const target = workspace.state.eventsById.get(eventId)
      if (target === undefined) {
        throw new GameregError('not_found', 'error.unknown_event', { id: eventId })
      }

      stage(cli, workspace, 'event.revoke', { target: eventId, reason: options.reason })
      const events = commit(cli, workspace)

      emit(cli, {
        action: 'event.revoke',
        result: { target: eventId, target_type: target.type },
        events,
        prose: [cli.t('prose.revoke.done', { id: eventId })],
      })
    })
}
