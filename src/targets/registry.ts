/**
 * The target registry (docs/spec/07-targets.md).
 *
 * Which targets *exist* is a closed vocabulary in `core/vocab.ts`, including the
 * ones that arrive in a later phase — so naming `sqlite` today says "phase 1",
 * not "no such thing". Which targets are *implemented* is this file.
 */
import { GameregError } from '../core/errors.ts'
import { checkTarget, type BuildTarget } from '../core/vocab.ts'
import { obsidian } from './obsidian.ts'
import type { Target } from './types.ts'

const REGISTRY: readonly Target[] = [obsidian]

export function allTargets(): readonly Target[] {
  return REGISTRY
}

export function targetByName(name: string): Target {
  const found = REGISTRY.find((target) => target.name === checkTarget(name))
  if (found === undefined) {
    // Vocabulary and phase both said yes, so nothing is left to say.
    throw new GameregError('error', 'error.unimplemented_target', { name })
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
