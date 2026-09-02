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
 * `[[slug]]`, a game note still embeds `assets/<sha>...` — `mirrorAssets` in
 * `mirror.ts` is what makes the second one resolve), even though `PlannedFile.path`
 * itself is vault-root-relative, `obsidian/...`, like every other target's.
 */
import { GameregError } from '../core/errors.ts'
import type { VaultState } from '../core/fold.ts'
import { OBSIDIAN } from '../render/flavour.ts'
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
        content: newNote(state, game, bundle, OBSIDIAN),
        policy: 'splice',
        parts: {
          frontmatter: frontmatter(game, OBSIDIAN, bundle),
          blocks: blocksOf(state, game, bundle, OBSIDIAN),
        },
      })

      // One note per run. `runs/` is data and is written whole; `games/` is
      // yours. That line has to be somewhere, and a folder boundary makes it
      // explainable in one sentence.
      for (const run of game.runs) {
        files.push({
          path: `obsidian/${runNotePath(game, run)}`,
          content: newRunNote(game, run, bundle, OBSIDIAN),
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
      content: newTable(state, bundle, OBSIDIAN),
      policy: 'splice',
      parts: { frontmatter: null, blocks: tableBlocks(state, bundle, OBSIDIAN) },
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
