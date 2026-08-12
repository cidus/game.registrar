/**
 * `gamereg build` (docs/spec/04-derived.md).
 *
 * Regenerates every derived artifact from the log. Idempotent: running it twice
 * produces byte-identical output. Deleting every note and rebuilding loses
 * nothing except hand-written prose, which is preserved in place instead.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { GameregError } from '../core/errors.ts'
import type { VaultState } from '../core/fold.ts'
import type { Vault } from '../core/vault.ts'
import type { Translator } from '../i18n/index.ts'
import { renderNote } from './note.ts'
import { renderTable } from './table.ts'

export type BuildResult = {
  notes: string[]
  written: string[]
  removed: string[]
  table: string
}

function read(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

/** LF endings, no trailing whitespace, exactly one trailing newline. */
function canonical(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
  return `${normalized.replace(/\n+$/, '')}\n`
}

function writeIfChanged(file: string, content: string, written: string[], force: boolean): void {
  const next = canonical(content)
  if (!force && read(file) === next) return
  writeFileSync(file, next, 'utf8')
  written.push(file)
}

export type BuildOptions = {
  /** Rewrite every derived file, changed or not. */
  force?: boolean
}

export function build(
  vault: Vault,
  state: VaultState,
  bundle: Translator,
  options: BuildOptions = {},
): BuildResult {
  const force = options.force === true
  mkdirSync(vault.gamesDir, { recursive: true })

  const slugs = new Map<string, string>()
  for (const game of state.games) {
    const owner = slugs.get(game.slug)
    if (owner !== undefined) {
      throw new GameregError('error', 'error.slug_collision', { slug: game.slug })
    }
    slugs.set(game.slug, game.game_id)
  }

  const notes: string[] = []
  const written: string[] = []
  const removed: string[] = []

  for (const game of state.games) {
    const file = join(vault.gamesDir, `${game.slug}.md`)
    notes.push(file)
    writeIfChanged(file, renderNote(read(file), game, bundle, file), written, force)

    // A rename leaves the old note behind; the build removes it rather than
    // orphaning it. Only slugs this game itself used are ever touched.
    for (const previous of game.previous_slugs) {
      if (slugs.has(previous)) continue
      const stale = join(vault.gamesDir, `${previous}.md`)
      if (!existsSync(stale)) continue
      rmSync(stale)
      removed.push(stale)
    }
  }

  writeIfChanged(
    vault.tableFile,
    renderTable(read(vault.tableFile), state, bundle, vault.tableFile),
    written,
    force,
  )

  return { notes, written, removed, table: vault.tableFile }
}
