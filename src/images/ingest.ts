/**
 * Image ingestion (docs/spec/04-derived.md "Image ingestion").
 *
 * Every incoming file goes through this pipeline before any event is
 * written: read EXIF, then discard it; normalize (auto-rotate, resize,
 * encode WebP); hash the normalized bytes; write to
 * `assets/<sha[0:2]>/<sha>.webp` if not already there. Deterministic, so
 * ingesting the same photo twice is a no-op the second time.
 *
 * GPS — and every other EXIF tag — is stripped unconditionally: `sharp`
 * only carries metadata into its output when told to (`withMetadata` /
 * `withExif`), and this pipeline never calls either, so the WebP output
 * simply never has an EXIF segment. Not configurable to false, per spec.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

import type { Config } from '../core/config.ts'
import { GameregError } from '../core/errors.ts'
import type { Vault } from '../core/vault.ts'
import { readCapturedAt } from './exif.ts'

export type IngestResult = {
  sha256: string
  ext: 'webp'
  /** Suggested only — the caller decides whether/how to use it (04-derived.md). */
  captured_at: string | null
  /** False when a file with this hash was already on disk: re-ingesting is a no-op. */
  written: boolean
  path: string
}

/**
 * Reads a file from disk, normalizes it, and writes it into `assets/` if its
 * hash is not already there. Performs no event-log I/O — the caller appends
 * whatever event carries the resulting attachment record.
 */
export async function ingestImage(vault: Vault, sourcePath: string, config: Config = vault.config): Promise<IngestResult> {
  let input: Buffer
  try {
    input = readFileSync(sourcePath)
  } catch (cause) {
    throw new GameregError('usage', 'error.text_file', { file: sourcePath }, { cause })
  }

  const source = sharp(input)
  const metadata = await source.metadata()
  const capturedAt = readCapturedAt(metadata.exif)

  let normalized: Buffer
  try {
    normalized = await sharp(input)
      .rotate()
      .resize({
        width: config.images.max_edge,
        height: config.images.max_edge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: config.images.quality })
      .toBuffer()
  } catch (cause) {
    throw new GameregError('usage', 'error.bad_image', { file: sourcePath }, { cause })
  }

  const sha256 = createHash('sha256').update(normalized).digest('hex')
  const relative = join('assets', sha256.slice(0, 2), `${sha256}.webp`)
  const target = join(vault.root, relative)

  let written = false
  if (!existsSync(target)) {
    mkdirSync(join(vault.root, 'assets', sha256.slice(0, 2)), { recursive: true })
    writeFileSync(target, normalized)
    written = true
  }

  if (config.images.keep_original) {
    const originalExt = (metadata.format ?? 'bin').toLowerCase()
    const originalPath = join(vault.root, 'assets', sha256.slice(0, 2), `${sha256}.original.${originalExt}`)
    if (!existsSync(originalPath)) {
      mkdirSync(join(vault.root, 'assets', sha256.slice(0, 2)), { recursive: true })
      writeFileSync(originalPath, input)
    }
  }

  return { sha256, ext: 'webp', captured_at: capturedAt, written, path: relative.split('\\').join('/') }
}
