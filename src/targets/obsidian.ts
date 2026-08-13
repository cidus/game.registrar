/**
 * The `obsidian` target (docs/spec/07-targets.md, docs/spec/04-derived.md).
 *
 * The vault as Obsidian reads it: one note per game, one note per run, and the
 * consolidated table. Game notes and the table are spliced, because they also
 * hold hand-written prose; run notes are written whole.
 */
import { GameregError } from '../core/errors.ts'
import type { VaultState } from '../core/fold.ts'
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
        path: `games/${game.slug}.md`,
        content: newNote(game, bundle),
        policy: 'splice',
        parts: { frontmatter: frontmatter(game), blocks: blocksOf(game, bundle) },
      })

      // One note per run. `runs/` is data and is written whole; `games/` is
      // yours. That line has to be somewhere, and a folder boundary makes it
      // explainable in one sentence.
      for (const run of game.runs) {
        files.push({
          path: runNotePath(game, run),
          content: newRunNote(game, run, bundle),
          policy: 'replace',
        })
      }
    }

    files.push({
      path: 'Games.md',
      content: newTable(state, bundle),
      policy: 'splice',
      parts: { frontmatter: null, blocks: tableBlocks(state, bundle) },
    })

    // A base is configuration, not derived data: Obsidian rewrites the file the
    // moment a column is reordered through the UI, and a build that regenerated
    // it would silently discard that work every time. Regenerating a note is
    // safe because prose lives outside the markers; a base has no outside.
    files.push({
      path: 'Games.base',
      content: template('Games.base'),
      policy: 'seed',
    })

    return files
  },
}
