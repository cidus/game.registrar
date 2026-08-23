/**
 * The `stats` target (docs/spec/07-targets.md).
 *
 * `obsidian/Stats.md`, one `obsidian/reviews/<year>.md` per year the log knows
 * about, and the heatmap of each of those years as its own SVG file.
 *
 * The renderers are shared (`render/heatmap.ts`, `render/review.ts`) and this
 * target decides only which files exist — the same seam `html` uses to put the
 * same heatmap inside a single self-contained page instead.
 *
 * Both notes are spliced rather than replaced, because the prose half of a year
 * in review is the user's (offered by the agent, accepted or refused by them)
 * and lives outside the markers, where invariant 3 protects it. The SVG has no
 * outside and is written whole.
 *
 * Which years exist comes from the log and never from the clock: a build in
 * December and a build the following January produce the same bytes.
 */
import type { VaultState } from '../core/fold.ts'
import {
  heatmapFor,
  heatmapPath,
  newReview,
  newStats,
  reviewBlocks,
  reviewFrontmatter,
  reviewNotePath,
  statsBlocks,
} from '../render/review.ts'
import { yearsPlayed } from '../render/heatmap.ts'
import type { PlannedFile, Target, TargetContext } from './types.ts'

export const stats: Target = {
  name: 'stats',
  since: 3,

  plan(state: VaultState, context: TargetContext): PlannedFile[] {
    const { bundle } = context
    const files: PlannedFile[] = [
      {
        path: 'obsidian/Stats.md',
        content: newStats(state, bundle),
        policy: 'splice',
        parts: { frontmatter: null, blocks: statsBlocks(state, bundle) },
      },
    ]

    for (const year of yearsPlayed(state)) {
      files.push({
        path: `obsidian/${reviewNotePath(year)}`,
        content: newReview(state, year, bundle),
        policy: 'splice',
        parts: { frontmatter: reviewFrontmatter(year), blocks: reviewBlocks(state, year, bundle) },
      })
      files.push({
        path: `obsidian/${heatmapPath(year)}`,
        content: heatmapFor(state, year, bundle),
        policy: 'replace',
      })
    }

    return files
  },
}
