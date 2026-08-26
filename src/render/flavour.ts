/**
 * Rendering flavours (docs/spec/07-targets.md, the `quartz` section).
 *
 * The same folded state is rendered as Markdown twice: once for Obsidian, once
 * for the tree Quartz consumes. `render/` emits the Markdown and `targets/`
 * decides which files exist, so a second consumer costs a parameter rather than
 * a second set of emitters — which is what let `quartz` stay an ordinary target
 * instead of a pass over what `obsidian` wrote (non-negotiable 8).
 *
 * The differences are deliberately few, and each is a property of the consumer
 * rather than a preference:
 *
 * - **Frontmatter.** Quartz reads `description` and `draft`; Obsidian has no
 *   use for either.
 * - **Assets.** An embed resolves only if the file is in that flavour's tree.
 *   In the vault it always is; on the site it is `images.publish` that decides,
 *   and when it is off the placeholder says so rather than the note pretending
 *   the picture is there.
 * - **Links.** Obsidian resolves `[[hollow-knight]]` anywhere in the vault by
 *   shortest match. Quartz's own default is to resolve a wikilink from the
 *   content root, so the site flavour writes the folder too — which also works
 *   under `shortest`, and therefore holds whatever the user later configures.
 * - **Prose.** A game note keeps an empty *Notes* heading for the user to write
 *   under; the site is generated whole and has no such half.
 */

export type FlavourName = 'obsidian' | 'quartz'

export type Flavour = {
  name: FlavourName
  /** Emit `description` and `draft`. */
  siteFrontmatter: boolean
  /** The asset files are in this tree, so `![[assets/...]]` resolves. */
  assets: boolean
  /** Write the folder in a wikilink rather than relying on shortest match. */
  qualifiedLinks: boolean
  /** Leave a heading for hand-written prose. */
  prose: boolean
}

export const OBSIDIAN: Flavour = {
  name: 'obsidian',
  siteFrontmatter: false,
  assets: true,
  qualifiedLinks: false,
  prose: true,
}

/**
 * `publishImages` is `images.publish` (docs/spec/04-derived.md, *Publication*),
 * which is what puts the asset files into `quartz/content/` at all. Off by
 * default: the local record is never degraded to satisfy the public one, and
 * the public one says plainly that a picture was withheld.
 */
export function quartzFlavour(publishImages: boolean): Flavour {
  return {
    name: 'quartz',
    siteFrontmatter: true,
    assets: publishImages,
    qualifiedLinks: true,
    prose: false,
  }
}

/** The wikilink target of a note in `games/`, `runs/` or `reviews/`, without the extension. */
export function noteRef(flavour: Flavour, folder: 'games' | 'runs' | 'reviews', name: string): string {
  return flavour.qualifiedLinks ? `${folder}/${name}` : name
}
