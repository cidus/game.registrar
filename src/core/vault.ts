/**
 * Vault paths (docs/spec/00-architecture.md "Two repositories").
 *
 * Nothing in the codebase writes outside `root`. Derived paths are planned
 * vault-relative with forward slashes and resolved here, where the assertion
 * lives.
 */
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { GameregError } from './errors.ts'
import { loadConfig, type Config } from './config.ts'
import type { TimeContext } from './time.ts'

export type Vault = {
  root: string
  eventsFile: string
  gamesDir: string
  runsDir: string
  dataDir: string
  tableFile: string
  assetsDir: string
  /** Build bookkeeping. Gitignored, and the only file the build reads back. */
  manifestFile: string
  config: Config
}

export function openVault(rootOverride?: string | undefined): Vault {
  const root = resolve(rootOverride ?? process.env['GAMEREG_VAULT'] ?? process.cwd())
  return {
    root,
    eventsFile: join(root, 'data', 'events.jsonl'),
    gamesDir: join(root, 'games'),
    runsDir: join(root, 'runs'),
    dataDir: join(root, 'data'),
    tableFile: join(root, 'Games.md'),
    assetsDir: join(root, 'assets'),
    manifestFile: join(root, '.gamereg', 'manifest.json'),
    config: loadConfig(root),
  }
}

/**
 * Resolves a vault-relative path, refusing anything that would escape the root.
 * A target that plans `../../etc/passwd` is a bug, and it stops here.
 */
export function vaultPath(vault: Vault, path: string): string {
  const absolute = resolve(vault.root, ...path.split('/'))
  const inside = relative(vault.root, absolute)
  if (path === '' || isAbsolute(path) || inside === '' || inside.startsWith(`..${sep}`) || inside === '..') {
    throw new GameregError('error', 'error.outside_vault', { path })
  }
  return absolute
}

/** The inverse: an absolute path as the manifest records it. */
export function vaultRelative(vault: Vault, absolute: string): string {
  return relative(vault.root, absolute).split(sep).join('/')
}

export function timeContext(vault: Vault): TimeContext {
  return { zone: vault.config.timezone, dayCutoff: vault.config.day_cutoff }
}
