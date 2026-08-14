/**
 * `gamereg platform add|remove|list` (docs/spec/02-cli.md "Platform
 * vocabulary").
 *
 * These edit `gamereg.config.json` and nothing else — no event, ever. The list
 * is a suggestion list and a spelling table, not state: removing a platform
 * takes nothing away from the runs already recorded on it, which is exactly
 * why `remove` can afford to be a no-op instead of an error.
 */
import type { Command } from 'commander'

import { writeConfig } from '../../core/config.ts'
import {
  addPlatform,
  canonicalPlatform,
  platformKey,
  platformTable,
  platformUsage,
  removePlatform,
} from '../../core/platforms.ts'
import { allAliases } from '../../i18n/index.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import { withGlobals, type Registrar } from '../register.ts'
import { load } from '../workspace.ts'

function localAliases(name: string): string[] {
  const aliases: string[] = []
  for (const [alias, canonical] of allAliases().commands) {
    if (canonical === name) aliases.push(alias)
  }
  return aliases
}

export function registerPlatform(registrar: Registrar): void {
  const group = registrar.command('platform', 'help.platform').helpCommand(false)

  const add = withGlobals(
    group.command('add').description(registrar.t('help.platform_add')),
    registrar.t,
  )
    .argument('<name>', registrar.t('help.arg.platform_name'))
    .argument('[synonyms...]', registrar.t('help.arg.platform_synonyms'))
  for (const alias of localAliases('add')) add.alias(alias)

  add.action(async (name: string, synonyms: string[], _options: unknown, command: Command) => {
    const cli = createContext(command)
    const config = cli.vault.config

    const before = config.platforms.length
    config.platforms = addPlatform(config.platforms, name, synonyms)
    if (!cli.dryRun) writeConfig(cli.vault.root, config)

    const table = platformTable(config.platforms)
    const canonical = canonicalPlatform(name, table) ?? name.trim()
    const entry = config.platforms.find((item) => item.name === canonical)

    emit(cli, {
      action: 'platform.add',
      result: {
        platform: canonical,
        aliases: entry?.aliases ?? [],
        added: config.platforms.length > before,
        platforms: config.platforms,
      },
      events: [],
      prose: [
        cli.t(
          (entry?.aliases ?? []).length === 0 ? 'prose.platform.added_bare' : 'prose.platform.added',
          { platform: canonical, aliases: (entry?.aliases ?? []).join(', ') },
        ),
      ],
    })
  })

  const remove = withGlobals(
    group.command('remove').description(registrar.t('help.platform_remove')),
    registrar.t,
  ).argument('<name>', registrar.t('help.arg.platform_name'))
  for (const alias of localAliases('remove')) remove.alias(alias)

  remove.action(async (name: string, _options: unknown, command: Command) => {
    const cli = createContext(command)
    const config = cli.vault.config

    const before = config.platforms.length
    config.platforms = removePlatform(config.platforms, name)
    const removed = config.platforms.length < before
    if (removed && !cli.dryRun) writeConfig(cli.vault.root, config)

    emit(cli, {
      action: 'platform.remove',
      result: { platform: name.trim(), removed, platforms: config.platforms },
      events: [],
      prose: [
        cli.t(removed ? 'prose.platform.removed' : 'prose.platform.absent', { platform: name.trim() }),
      ],
    })
  })

  const list = withGlobals(
    group.command('list').description(registrar.t('help.platform_list')),
    registrar.t,
  )
  for (const alias of localAliases('list')) list.alias(alias)

  list.action(async (_options: unknown, command: Command) => {
    const cli = createContext(command)
    const config = cli.vault.config
    const table = platformTable(config.platforms)
    // An agent has to know what to offer before it can offer anything, and the
    // run counts are what tell a real platform from one typed once by mistake.
    const usage = platformUsage(load(cli).state, table)

    const rows = config.platforms.map((entry) => ({
      platform: entry.name,
      aliases: entry.aliases,
      runs: usage.get(platformKey(entry.name)) ?? 0,
    }))

    const prose =
      rows.length === 0
        ? [cli.t('prose.platform.none')]
        : rows.map((row) =>
            cli.t(row.aliases.length === 0 ? 'prose.platform.row_bare' : 'prose.platform.row', {
              platform: row.platform,
              aliases: row.aliases.join(', '),
              runs: row.runs,
            }),
          )

    emit(cli, { action: 'platform.list', result: { platforms: rows }, events: [], prose })
  })
}
