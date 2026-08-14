/**
 * Shared by the game note and the run note — both embed or link a cover by
 * hash (docs/spec/04-derived.md "Content addressing"). Its own file so
 * neither note module has to import the other.
 */

/** Every attachment is normalized to WebP by the ingestion pipeline, so the
 * hash alone determines the path. */
export function assetPath(sha256: string): string {
  return `assets/${sha256.slice(0, 2)}/${sha256}.webp`
}
