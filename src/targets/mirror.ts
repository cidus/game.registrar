/**
 * Making `![[assets/<sha>...]]` resolve inside a generated tree (07-targets.md).
 *
 * `assets/` lives at the vault root, written by image ingestion (`--photo`)
 * independent of any build target (00-architecture.md, *Two repositories*), so
 * a tree that is not the vault root — `obsidian/`, which is what a user opens
 * as their Obsidian vault, and `quartz/content/`, which is what Quartz reads —
 * has to have the assets reachable from inside it for an embed to resolve.
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
import { copyFileSync, linkSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import type { Vault } from '../core/vault.ts'

/** `<vault>/<folder>/assets`, where `folder` is vault-relative. */
export function mirrorAssets(vault: Vault, folder: string): void {
  const source = join(vault.root, 'assets')
  if (lstatSync(source, { throwIfNoEntry: false })?.isDirectory() !== true) return

  const target = join(vault.root, ...folder.split('/'), 'assets')
  const existing = lstatSync(target, { throwIfNoEntry: false })

  // The symlink earlier versions created is this function's own doing and is
  // replaced. Anything else at that path is someone's on purpose and is not
  // touched — including a symlink pointing somewhere other than `assets/`.
  if (existing?.isSymbolicLink() === true) {
    const own = relative(join(target, '..'), source).split(sep).join('/')
    if (readLinkTarget(target) !== own) return
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
