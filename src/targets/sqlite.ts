/**
 * The `sqlite` target (docs/spec/07-targets.md).
 *
 * A cache, never a source of truth (00-architecture.md invariant 10):
 * deleting `data/log.db` costs nothing, `gamereg query` only reads it, and
 * nothing but this target writes it.
 */
import { buildDatabase } from '../db/build.ts'
import type { VaultState } from '../core/fold.ts'
import type { PlannedFile, Target, TargetContext } from './types.ts'

export const sqlite: Target = {
  name: 'sqlite',
  since: 1,

  plan(state: VaultState, _context: TargetContext): PlannedFile[] {
    return [{ path: 'data/log.db', content: buildDatabase(state), policy: 'replace' }]
  },
}
