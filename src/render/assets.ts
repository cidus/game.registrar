/**
 * Shared by the game note, the run note and the table — all three embed or link
 * a cover by hash (docs/spec/04-derived.md "Content addressing"). Its own file
 * so no two of those modules have to import each other.
 */
import type { Translator } from '../i18n/index.ts'
import type { Flavour } from './flavour.ts'

/** Every attachment is normalized to WebP by the ingestion pipeline, so the
 * hash alone determines the path. */
export function assetPath(sha256: string): string {
  return `assets/${sha256.slice(0, 2)}/${sha256}.webp`
}

/**
 * The embed, or the reason there isn't one.
 *
 * An embed resolves only if the file is in the tree being rendered. In the
 * vault it always is; in `quartz/content/` it is there only when
 * `images.publish` is on (docs/spec/04-derived.md, *Publication*), and a
 * published page that says the picture was withheld is better than one showing
 * a broken embed.
 */
export function assetEmbed(sha256: string, flavour: Flavour, bundle: Translator): string {
  if (!flavour.assets) return `*${bundle.t('note.image.unpublished')}*`
  return `![[${assetPath(sha256)}]]`
}

/**
 * The same, sized, for a table cell — where the escaped pipe is Obsidian's own
 * embed-width syntax and has to survive the cell.
 *
 * Unpublished, this is empty rather than a placeholder: the column already
 * renders empty for a game with no cover, so an unpublished one costs no new
 * shape, and a sentence repeated down every row of a table is noise where the
 * same sentence on a page is information.
 */
export function assetThumb(sha256: string, flavour: Flavour, width: number): string {
  if (!flavour.assets) return ''
  return `![[${assetPath(sha256)}\\|${width}]]`
}
