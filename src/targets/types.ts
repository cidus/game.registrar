/**
 * The target contract (docs/spec/07-targets.md).
 *
 * A target is a pure function from folded state to a list of files. It reads the
 * folded state and the config, and nothing else: not the filesystem, not the
 * network, not its own previous output, not another target's. That is what keeps
 * the build a projection instead of a migration.
 *
 * Applying a file to disk is the *writer's* job, not the target's — which is why
 * a spliced file is planned as the whole document it would be if the note did
 * not exist, plus the pieces the writer splices into the note that does.
 */
import type { Config } from '../core/config.ts'
import type { VaultState } from '../core/fold.ts'
import type { BuildTarget } from '../core/vocab.ts'
import type { Translator } from '../i18n/index.ts'
import type { BlockContent } from '../render/markers.ts'

/**
 * `replace` — the file is generated in full.
 * `splice` — only the regions between markers are written.
 * `seed` — written if absent; never overwritten, never removed.
 */
export type WritePolicy = 'replace' | 'splice' | 'seed'

/** What a `splice` writes into a note that already exists. */
export type SplicePlan = {
  /** Regenerated wholesale, or null for a file that carries none. */
  frontmatter: string | null
  blocks: readonly BlockContent[]
}

export type PlannedFile = {
  /** Vault-relative, forward slashes on every platform. Never escapes the root. */
  path: string
  /** The whole file, as it would be created from nothing. */
  content: string | Buffer
  policy: WritePolicy
  /** Required by `splice`, meaningless otherwise. */
  parts?: SplicePlan
}

export type TargetContext = {
  config: Config
  bundle: Translator
}

export type Target = {
  /** Stable identifier. Also the CLI argument and the config key. */
  name: BuildTarget
  /** Phase in which it becomes available; the CLI rejects the rest. */
  since: 0 | 1 | 3
  plan(state: VaultState, context: TargetContext): PlannedFile[]
}
