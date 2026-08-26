/**
 * The `quartz` target (docs/spec/07-targets.md, docs/spec/04-derived.md).
 *
 * The vault as a stranger reads it: the same notes, planned a second time in
 * the flavour Quartz consumes, plus a seeded `quartz.config.yaml`.
 *
 * **An ordinary target.** It plans its files from the folded state like every
 * other one — it does not read `obsidian/`, does not run Quartz, spawns no
 * subprocess and touches no network. An earlier design had it running Quartz
 * over the finished vault, which would have made non-negotiable 8 contradict
 * itself; the fix was to make the claim false rather than the invariant weaker,
 * and it cost one parameter through `render/` (see `render/flavour.ts`).
 *
 * Every note is `replace`: the site carries what the log knows, and prose typed
 * by hand into a game note lives on disk outside the markers and never reaches
 * the folded state. That is a property rather than a shortfall — what is
 * written in Obsidian stays private by construction, and what is meant to be
 * public is filed through the CLI as a note or a verdict.
 *
 * Paths are `quartz/content/...`, and the doubled name in
 * `quartz/quartz.config.yaml` is Quartz's own convention, not a slip.
 */
import { GameregError } from '../core/errors.ts'
import type { VaultState } from '../core/fold.ts'
import { quartzFlavour } from '../render/flavour.ts'
import { yearsPlayed } from '../render/heatmap.ts'
import { newNote } from '../render/note.ts'
import { heatmapFor, heatmapPath, newReview, newStats, reviewNotePath } from '../render/review.ts'
import { newRunNote, runNotePath } from '../render/run.ts'
import { newTable } from '../render/table.ts'
import { template } from './templates.ts'
import type { PlannedFile, Target, TargetContext } from './types.ts'

export const CONTENT = 'quartz/content'

export const quartz: Target = {
  name: 'quartz',
  since: 3,

  plan(state: VaultState, context: TargetContext): PlannedFile[] {
    const { bundle, config } = context
    // `images.publish` is what puts the asset files into the content tree at
    // all (04-derived.md, *Publication*); with it off the notes say a picture
    // was withheld rather than embedding one that is not there.
    const flavour = quartzFlavour(config.images.publish)
    const files: PlannedFile[] = []

    // Two games claiming one filename is a hard error, not a last-write-wins —
    // the same rule the vault's own notes follow.
    const slugs = new Set<string>()
    for (const game of state.games) {
      if (slugs.has(game.slug)) {
        throw new GameregError('error', 'error.slug_collision', { slug: game.slug })
      }
      slugs.add(game.slug)
    }

    for (const game of state.games) {
      files.push({
        path: `${CONTENT}/games/${game.slug}.md`,
        content: newNote(state, game, bundle, flavour),
        policy: 'replace',
      })
      for (const run of game.runs) {
        files.push({
          path: `${CONTENT}/${runNotePath(game, run)}`,
          content: newRunNote(game, run, bundle, flavour),
          policy: 'replace',
        })
      }
    }

    // `index.md` is Quartz's landing page, and the consolidated table is what a
    // register's front page is for. It is `Game List.md` in the vault because
    // Obsidian shows a basename and a file called `index` says nothing there.
    files.push({
      path: `${CONTENT}/index.md`,
      content: newTable(state, bundle, flavour),
      policy: 'replace',
    })

    // The vault's Stats.md and its year-in-review notes, on the site too — the
    // same renderers `stats` uses, reused through the flavour seam rather than
    // a second set of emitters (render/flavour.ts). Always `replace`: a Quartz
    // note has no hand-prose slot to preserve (flavour.prose is false).
    files.push({
      path: `${CONTENT}/stats.md`,
      content: newStats(state, bundle, flavour),
      policy: 'replace',
    })
    for (const year of yearsPlayed(state)) {
      files.push({
        path: `${CONTENT}/${reviewNotePath(year)}`,
        content: newReview(state, year, bundle, flavour),
        policy: 'replace',
      })
      files.push({
        path: `${CONTENT}/${heatmapPath(year)}`,
        content: heatmapFor(state, year, bundle),
        policy: 'replace',
      })
    }

    // Configuration, not derived data — the same argument the `.base` gets:
    // the user's edit is the point, and regenerating over it would discard
    // their site on every build. `gamereg build --force` is the way back to
    // the shipped default.
    files.push({
      path: 'quartz/quartz.config.yaml',
      content: template('quartz.config.yaml'),
      policy: 'seed',
    })

    return files
  },
}
