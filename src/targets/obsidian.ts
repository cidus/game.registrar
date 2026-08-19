/**
 * The `obsidian` target (docs/spec/07-targets.md, docs/spec/04-derived.md).
 *
 * The vault as Obsidian reads it: one note per game, one note per run, and the
 * consolidated table. Game notes and the table are spliced, because they also
 * hold hand-written prose; run notes are written whole.
 *
 * Everything lands under `obsidian/`, so the folder you open as the Obsidian
 * vault holds only what Obsidian should see — not `data/`, not
 * `gamereg.secrets.json`, not `.gamereg/`. Every path here is relative to
 * *that* folder internally (a run note still links a game note as
 * `[[slug]]`, a game note still embeds `assets/<sha>...` — `ensureAssetsLink`
 * below is what makes the second one resolve), even though `PlannedFile.path`
 * itself is vault-root-relative, `obsidian/...`, like every other target's.
 */
import { copyFileSync, linkSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { GameregError } from '../core/errors.ts'
import type { VaultState } from '../core/fold.ts'
import type { Vault } from '../core/vault.ts'
import { blocksOf, frontmatter, newNote } from '../render/note.ts'
import { newRunNote, runNotePath } from '../render/run.ts'
import { newTable, tableBlocks } from '../render/table.ts'
import { template } from './templates.ts'
import type { PlannedFile, Target, TargetContext } from './types.ts'

export const obsidian: Target = {
  name: 'obsidian',
  since: 0,

  plan(state: VaultState, context: TargetContext): PlannedFile[] {
    const { bundle } = context
    const files: PlannedFile[] = []

    // Two games claiming one filename is a hard error, not a last-write-wins.
    const slugs = new Set<string>()
    for (const game of state.games) {
      if (slugs.has(game.slug)) {
        throw new GameregError('error', 'error.slug_collision', { slug: game.slug })
      }
      slugs.add(game.slug)
    }

    for (const game of state.games) {
      files.push({
        path: `obsidian/games/${game.slug}.md`,
        content: newNote(state, game, bundle),
        policy: 'splice',
        parts: { frontmatter: frontmatter(game), blocks: blocksOf(state, game, bundle) },
      })

      // One note per run. `runs/` is data and is written whole; `games/` is
      // yours. That line has to be somewhere, and a folder boundary makes it
      // explainable in one sentence.
      for (const run of game.runs) {
        files.push({
          path: `obsidian/${runNotePath(game, run)}`,
          content: newRunNote(game, run, bundle),
          policy: 'replace',
        })
      }
    }

    // "Game List" / "Game Database", not "Games" / "Games" — Obsidian's file
    // explorer and quick switcher show the basename with no extension, and
    // two files named the same but for `.md` vs `.base` were indistinguishable
    // at a glance.
    files.push({
      path: 'obsidian/Game List.md',
      content: newTable(state, bundle),
      policy: 'splice',
      parts: { frontmatter: null, blocks: tableBlocks(state, bundle) },
    })

    // A base is configuration, not derived data: Obsidian rewrites the file the
    // moment a column is reordered through the UI, and a build that regenerated
    // it would silently discard that work every time. Regenerating a note is
    // safe because prose lives outside the markers; a base has no outside.
    files.push({
      path: 'obsidian/Game Database.base',
      content: template('Game Database.base'),
      policy: 'seed',
    })

    return files
  },
}

/**
 * `obsidian/assets` → `../assets`, so `![[assets/<sha>...]]` resolves once
 * Obsidian is pointed at the `obsidian/` folder rather than the vault root, so
 * `assets/` — which lives at the vault root, written by image ingestion
 * independent of any build target (00-architecture.md, *Two repositories*) —
 * has to be reachable from inside that narrower folder for
 * `![[assets/<sha>...]]` to resolve.
 *
 * **Hardlinks, not a symlink.** A symlink was the first implementation and it
 * works on macOS; Obsidian on Linux does not traverse one, so every embed in
 * the vault silently showed nothing. A hardlink is not a link to follow — it is
 * the file, under a second name — so there is nothing for an indexer to refuse.
 * It also costs no space: one inode, two names. Only when the link cannot be
 * made (a separate mount, a filesystem without them) does this fall back to
 * copying the bytes.
 *
 * Only ever adds. Nothing in gamereg deletes an ingested asset, so nothing here
 * needs to either, and that keeps this clear of non-negotiable 9 — the build
 * removes only what the manifest says it owns, and these are not planned files.
 * They are content-addressed and immutable, so a name that exists is already
 * the right bytes and is left alone, which is also what makes a second build
 * touch nothing.
 */
export function mirrorAssets(vault: Vault): void {
  const source = join(vault.root, 'assets')
  if (lstatSync(source, { throwIfNoEntry: false })?.isDirectory() !== true) return

  const target = join(vault.root, 'obsidian', 'assets')
  const existing = lstatSync(target, { throwIfNoEntry: false })

  // The symlink earlier versions created is this function's own doing and is
  // replaced. Anything else at that path is someone's on purpose and is not
  // touched — including a symlink pointing somewhere other than `../assets`.
  if (existing?.isSymbolicLink() === true) {
    if (readLinkTarget(target) !== '../assets') return
    rmSync(target)
  } else if (existing !== undefined && !existing.isDirectory()) {
    return
  }

  for (const shard of readdirSync(source, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue
    const from = join(source, shard.name)
    const to = join(target, shard.name)
    mkdirSync(to, { recursive: true })

    for (const asset of readdirSync(from, { withFileTypes: true })) {
      if (!asset.isFile()) continue
      const destination = join(to, asset.name)
      if (lstatSync(destination, { throwIfNoEntry: false }) !== undefined) continue
      try {
        linkSync(join(from, asset.name), destination)
      } catch {
        copyFileSync(join(from, asset.name), destination)
      }
    }
  }
}

function readLinkTarget(path: string): string | null {
  try {
    return readlinkSync(path)
  } catch {
    return null
  }
}
