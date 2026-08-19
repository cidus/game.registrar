/**
 * `gamereg build` — one fold of the log, every declared target, one pass
 * (docs/spec/07-targets.md).
 *
 * The order is deliberate: plan everything, then write, then remove, then record
 * ownership. Bookkeeping is last and reflects what actually happened, so a
 * target that fails halfway still has its successful writes recorded and the
 * next build does not orphan them.
 */
import { existsSync, rmSync } from 'node:fs'

import type { Config } from '../core/config.ts'
import { GameregError } from '../core/errors.ts'
import type { VaultState } from '../core/fold.ts'
import { canonicalPlatform, canonicalPlatforms, platformTable } from '../core/platforms.ts'
import { vaultPath, type Vault } from '../core/vault.ts'
import type { BuildTarget } from '../core/vocab.ts'
import type { Translator } from '../i18n/index.ts'
import {
  emptyManifest,
  readManifest,
  writeManifest,
  type TargetOwnership,
} from './manifest.ts'
import { acquireBuildLock } from './lock.ts'
import { mirrorAssets } from './obsidian.ts'
import { narrowTo, targetByName } from './registry.ts'
import type { PlannedFile, TargetContext, WritePolicy } from './types.ts'
import { applyFile } from './write.ts'

export type PlannedEntry = {
  target: BuildTarget
  path: string
  policy: WritePolicy
}

export type TargetFailure = {
  target: BuildTarget
  message: string
}

export type BuildResult = {
  /** The targets this run was responsible for. */
  targets: BuildTarget[]
  planned: PlannedEntry[]
  /** Vault-relative, and only what actually changed on disk. */
  written: string[]
  removed: string[]
  failed: TargetFailure[]
}

export type BuildOptions = {
  /** Rewrite every derived file, changed or not. Overwrites seeds. */
  force?: boolean
  /** Narrow the build to a subset of the vault's declared targets. */
  only?: readonly string[] | undefined
  /** Report the plan; write nothing. */
  dryRun?: boolean
}

function messageOf(error: unknown, bundle: Translator): string {
  if (error instanceof GameregError) return bundle.t(error.key, error.params)
  return error instanceof Error ? error.message : String(error)
}

/**
 * The read-side half of platform canonicalization (docs/spec/02-cli.md
 * "Canonicalization happens at two boundaries").
 *
 * This is the pass that fixes history: adding `Megadrive` as a synonym today
 * makes runs recorded in 2019 render as one platform, with no `event.amend`
 * and without a line of the log being rewritten. It runs here, once, over a
 * copy — the fold stays pure over events and never reads the table, and every
 * target sees the same spellings without having to remember to ask.
 *
 * `platform_raw` is left exactly as recorded, so a bad canonicalization is
 * always visible and never destructive.
 */
export function canonicalizeState(state: VaultState, config: Config): VaultState {
  const table = platformTable(config.platforms)
  if (table.lookup.size === 0) return state

  const projected = structuredClone(state)
  for (const run of projected.runsById.values()) {
    run.platform = canonicalPlatform(run.platform, table)
  }
  for (const game of projected.games) {
    game.platforms = canonicalPlatforms(game.platforms, table)
  }
  return projected
}

/** A path the manifest holds but this vault cannot address is never touched. */
function insideVault(vault: Vault, path: string): string | null {
  try {
    return vaultPath(vault, path)
  } catch {
    return null
  }
}

/**
 * The planning pass, checked: every path stays inside the vault, and no two
 * targets claim the same one. Both are hard errors, and both are raised before
 * anything is written — a build that has already half-run cannot take them back.
 */
export function claimPaths(
  vault: Vault,
  plans: ReadonlyMap<BuildTarget, readonly PlannedFile[]>,
): { owner: Map<string, BuildTarget>; planned: PlannedEntry[] } {
  const owner = new Map<string, BuildTarget>()
  const planned: PlannedEntry[] = []

  for (const [name, files] of plans) {
    for (const file of files) {
      vaultPath(vault, file.path)
      const other = owner.get(file.path)
      if (other !== undefined) {
        throw new GameregError('error', 'error.target_conflict', {
          path: file.path,
          first: other,
          second: name,
        })
      }
      owner.set(file.path, name)
      planned.push({ target: name, path: file.path, policy: file.policy })
    }
  }

  return { owner, planned }
}

export type BuildPlan = {
  targets: BuildTarget[]
  narrowed: boolean
  plans: Map<BuildTarget, PlannedFile[]>
  planned: PlannedEntry[]
  /** Path → the target that claims it. */
  owner: Map<string, BuildTarget>
  failed: TargetFailure[]
}

/**
 * Steps 1 and 2 on their own, for `--dry-run` and for `doctor`, which want the
 * answers a plan gives without the writing.
 */
export function planBuild(
  vault: Vault,
  state: VaultState,
  bundle: Translator,
  options: BuildOptions = {},
): BuildPlan {
  const declared = vault.config.build.targets
  const narrowed = options.only !== undefined && options.only.length > 0
  const targets = narrowed ? narrowTo(options.only ?? [], declared) : [...declared]

  const context: TargetContext = { config: vault.config, bundle }
  const failed: TargetFailure[] = []
  const projected = canonicalizeState(state, vault.config)

  // 1. Plan. A target that cannot plan takes nothing else down with it.
  const plans = new Map<BuildTarget, PlannedFile[]>()
  for (const name of targets) {
    try {
      plans.set(name, targetByName(name).plan(projected, context))
    } catch (error) {
      failed.push({ target: name, message: messageOf(error, bundle) })
    }
  }

  // 2. Two targets planning one path is a hard error, like a slug collision, and
  //    it is caught before a single byte is written.
  const { owner, planned } = claimPaths(vault, plans)

  return { targets, narrowed, plans, planned, owner, failed }
}

export function build(
  vault: Vault,
  state: VaultState,
  bundle: Translator,
  options: BuildOptions = {},
): BuildResult {
  const force = options.force === true
  const declared = vault.config.build.targets
  const { targets: selected, narrowed, plans, planned, owner, failed } = planBuild(
    vault,
    state,
    bundle,
    options,
  )

  if (options.dryRun === true) {
    return { targets: selected, planned, written: [], removed: [], failed }
  }

  // Nothing above this line touches the vault: planning reads only state and
  // config (non-negotiable 8), and the sqlite target's own build happens in a
  // throwaway temp directory. The lock only needs to cover what follows —
  // held for the whole write-through-record pass, released even if a target
  // throws, so a build that fails halfway never leaves the next one jammed.
  const release = acquireBuildLock(vault)
  try {
    return writeAndRecord()
  } finally {
    release()
  }

  // 3. Write. Ownership accrues as each file lands, never in advance.
  function writeAndRecord(): BuildResult {
    const manifest = readManifest(vault.manifestFile)
    const written: string[] = []
    const removed: string[] = []
    const ownership = new Map<BuildTarget, TargetOwnership>()
    const partial = new Set<BuildTarget>()

    for (const [name, files] of plans) {
      const done: TargetOwnership = { files: [], seeds: [] }
      ownership.set(name, done)
      try {
        for (const file of files) {
          if (applyFile(vault, file, force)) written.push(file.path)
          if (file.policy === 'seed') done.seeds.push(file.path)
          else done.files.push(file.path)
        }
      } catch (error) {
        failed.push({ target: name, message: messageOf(error, bundle) })
        partial.add(name)
        // What was written stays owned, and so does everything it owned before.
        const previous = manifest?.targets[name]
        if (previous !== undefined) {
          done.files.push(...previous.files)
          done.seeds.push(...previous.seeds)
        }
      }
    }

    // Obsidian's own folder needs `assets` visible inside it — see
    // obsidian.ts's mirrorAssets. Not planned files: their bytes are
    // ingestion's, not this build's, and a target may not read the filesystem
    // (non-negotiable 8), so this sits outside the manifest/ownership
    // machinery entirely. Add-only and idempotent, and only for a target that
    // actually ran.
    if (plans.has('obsidian')) mirrorAssets(vault)

    // 4. Remove. The only part of the build that deletes, and it deletes only what
    //    the manifest says a target owns and no longer plans. A missing manifest
    //    skips this entirely rather than guessing ownership from filenames.
    if (manifest !== null) {
      for (const [name, previous] of Object.entries(manifest.targets)) {
        if (partial.has(name as BuildTarget)) continue
        const current = ownership.get(name as BuildTarget)
        // A target that did not run is cleaned only when a full build establishes
        // that the vault no longer declares it. A narrowed build says nothing
        // about the targets it was not asked to build.
        const ran = current !== undefined
        const dropped = !narrowed && !declared.includes(name as BuildTarget)
        if (!ran && !dropped) continue

        const keep = new Set(current?.files ?? [])
        for (const path of previous.files) {
          if (keep.has(path) || owner.has(path)) continue
          const file = insideVault(vault, path)
          if (file === null || !existsSync(file)) continue
          rmSync(file)
          removed.push(path)
        }
      }
    }

    // 5. Record. Targets that did not run keep the ownership they had; a target
    //    the vault no longer declares keeps only its seeds, which are nobody's to
    //    remove but stay accounted for.
    const next = emptyManifest()
    for (const [name, previous] of Object.entries(manifest?.targets ?? {})) {
      if (ownership.has(name as BuildTarget)) continue
      if (narrowed || declared.includes(name as BuildTarget)) next.targets[name] = previous
      else if (previous.seeds.length > 0) next.targets[name] = { files: [], seeds: previous.seeds }
    }
    for (const [name, current] of ownership) next.targets[name] = current
    writeManifest(vault.manifestFile, next)

    return { targets: selected, planned, written, removed, failed }
  }
}
