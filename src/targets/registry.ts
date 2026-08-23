/**
 * The target registry (docs/spec/07-targets.md).
 *
 * Which targets *exist* is a closed vocabulary in `core/vocab.ts`, including the
 * ones that arrive in a later phase — so naming `sqlite` today says "phase 1",
 * not "no such thing". Which targets are *implemented* is this file.
 */
import { GameregError } from '../core/errors.ts'
import { checkTarget, type BuildTarget } from '../core/vocab.ts'
import { csv } from './csv.ts'
import { html } from './html.ts'
import { json } from './json.ts'
import { obsidian } from './obsidian.ts'
import { quartz } from './quartz.ts'
import { sqlite } from './sqlite.ts'
import { stats } from './stats.ts'
import type { Target } from './types.ts'

const REGISTRY: readonly Target[] = [obsidian, csv, sqlite, json, html, stats, quartz]

export function allTargets(): readonly Target[] {
  return REGISTRY
}

export function targetByName(name: string): Target {
  const found = REGISTRY.find((target) => target.name === checkTarget(name))
  if (found === undefined) {
    // Vocabulary and phase both said yes, so nothing is left to say. Usage,
    // not error: this is still "that name buys you nothing in this version",
    // the same answer `error.target_phase` gives with the same exit code — a
    // phase is delivered in steps, and between two of them a declared target
    // can be current and unbuilt at once.
    throw new GameregError('usage', 'error.unimplemented_target', { name })
  }
  return found
}

/**
 * The argument narrows a build; it never defines what the vault contains. A
 * target the vault does not declare is not this vault's to write.
 */
export function narrowTo(names: readonly string[], declared: readonly BuildTarget[]): BuildTarget[] {
  const selected: BuildTarget[] = []
  for (const value of names) {
    const name = checkTarget(value)
    if (!declared.includes(name)) {
      throw new GameregError('usage', 'error.target_not_declared', {
        name,
        declared: declared.join(', '),
      })
    }
    if (!selected.includes(name)) selected.push(name)
  }
  return selected
}
