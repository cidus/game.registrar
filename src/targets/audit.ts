/**
 * What `gamereg doctor` can say about derived artifacts, as opposed to the log
 * (docs/spec/02-cli.md, docs/spec/04-derived.md).
 *
 * Everything here reports and nothing fixes. The build deletes only what it
 * owns and leaves everything else alone; this is where the user hears what was
 * left alone, and why.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { GameregError } from '../core/errors.ts'
import type { FoldProblem, VaultState } from '../core/fold.ts'
import { vaultPath, vaultRelative, type Vault } from '../core/vault.ts'
import type { Translator } from '../i18n/index.ts'
import { findRegions } from '../render/markers.ts'
import { planBuild } from './build.ts'
import { ownedPaths, readManifest } from './manifest.ts'
import type { PlannedFile } from './types.ts'

const MARKER = /<!--\s*gamereg:begin\s+block=/i

/** Everything the `obsidian` target writes lives under here (07-targets.md). */
const OBSIDIAN_ROOT = 'obsidian'

/** Where a generated Markdown artifact can live, besides `OBSIDIAN_ROOT` itself. */
const SEARCHED = ['games', 'runs']

function problem(key: string, params: Record<string, unknown>): FoldProblem {
  return { key, params, event_id: null }
}

/**
 * Lines that are neither frontmatter, nor inside a generated region, nor blank.
 * In a game note this is the user's prose, which the build never touches. In a
 * run note, which is written whole, it is prose about to be lost.
 */
function outsideMarkers(source: string, file: string): string[] {
  let rest = source
  for (const region of [...findRegions(source, file)].reverse()) {
    rest = rest.slice(0, region.start) + rest.slice(region.end)
  }
  return rest
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function markdownFiles(vault: Vault): string[] {
  const found: string[] = []
  const base = join(vault.root, OBSIDIAN_ROOT)
  if (!existsSync(base)) return found

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) found.push(`${OBSIDIAN_ROOT}/${entry.name}`)
  }
  for (const name of SEARCHED) {
    const dir = join(base, name)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      found.push(vaultRelative(vault, join(entry.parentPath, entry.name)))
    }
  }

  return [...new Set(found)].sort()
}

/** The blocks a file is supposed to carry, whichever policy writes it. */
function knownBlocks(plan: PlannedFile, path: string): Set<string> {
  if (plan.parts !== undefined) return new Set(plan.parts.blocks.map((entry) => entry.block))
  if (typeof plan.content !== 'string') return new Set()
  return new Set(findRegions(plan.content, path).map((region) => region.block))
}

export function auditArtifacts(vault: Vault, state: VaultState, bundle: Translator): FoldProblem[] {
  const problems: FoldProblem[] = []

  // The planning pass, run for its answers rather than its output. Two targets
  // claiming one path aborts a build; here it is a finding like any other.
  let plans
  try {
    plans = planBuild(vault, state, bundle)
  } catch (error) {
    if (!(error instanceof GameregError)) throw error
    return [problem(error.key, error.params)]
  }

  for (const failure of plans.failed) problems.push(problem('doctor.target_failed', failure))

  const byPath = new Map<string, PlannedFile>()
  for (const files of plans.plans.values()) {
    for (const file of files) byPath.set(file.path, file)
  }

  const owned = ownedPaths(readManifest(vault.manifestFile))
  for (const path of byPath.keys()) owned.add(path)

  for (const path of markdownFiles(vault)) {
    const source = readFileSync(vaultPath(vault, path), 'utf8')
    const plan = byPath.get(path)

    if (plan === undefined) {
      // A file carrying the marks of generation that is in no plan and in no
      // manifest is an orphan — most often the remains of a build whose
      // manifest was lost. The build will never touch it; the user should know.
      if (MARKER.test(source) && !owned.has(path)) {
        problems.push(problem('doctor.orphan_artifact', { file: path }))
      }
      continue
    }

    try {
      // A block this version does not write is left untouched by the build and
      // reported here: it is someone's, or a newer version's, and not the
      // build's to remove (04-derived, marker rule 7).
      const known = knownBlocks(plan, path)
      for (const region of findRegions(source, path)) {
        if (known.has(region.block)) continue
        problems.push(problem('doctor.unknown_block', { file: path, block: region.block }))
      }

      // A run note is written whole. Anything typed into it outside the markers
      // disappears at the next build, and the user should hear it beforehand.
      if (plan.policy === 'replace' && typeof plan.content === 'string') {
        const expected = outsideMarkers(plan.content, path)
        const surplus = outsideMarkers(source, path)
        for (const line of expected) {
          const index = surplus.indexOf(line)
          if (index !== -1) surplus.splice(index, 1)
        }
        if (surplus.length > 0) {
          problems.push(problem('doctor.run_note_prose', { file: path, text: surplus[0] }))
        }
      }
    } catch (error) {
      if (!(error instanceof GameregError)) throw error
      problems.push(problem(error.key, error.params))
    }
  }

  return problems
}
