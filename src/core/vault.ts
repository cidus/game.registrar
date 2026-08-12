/**
 * Vault paths (docs/spec/00-architecture.md "Two repositories").
 *
 * Nothing in the codebase writes outside `root`.
 */
import { join, resolve } from 'node:path'

import { loadConfig, type Config } from './config.ts'
import type { TimeContext } from './time.ts'

export type Vault = {
  root: string
  eventsFile: string
  gamesDir: string
  tableFile: string
  assetsDir: string
  config: Config
}

export function openVault(rootOverride?: string | undefined): Vault {
  const root = resolve(rootOverride ?? process.env['GAMEREG_VAULT'] ?? process.cwd())
  return {
    root,
    eventsFile: join(root, 'data', 'events.jsonl'),
    gamesDir: join(root, 'games'),
    tableFile: join(root, 'Games.md'),
    assetsDir: join(root, 'assets'),
    config: loadConfig(root),
  }
}

export function timeContext(vault: Vault): TimeContext {
  return { zone: vault.config.timezone, dayCutoff: vault.config.day_cutoff }
}
