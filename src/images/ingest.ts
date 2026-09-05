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
 * The pipeline itself, shared by every source of bytes — a local `--photo`
 * file, or a provider's cover URL (`ingestUrl` below). `label` is only for
 * `error.bad_image`, so the message names whatever the caller was ingesting.
 */
async function ingestBuffer(vault: Vault, input: Buffer, config: Config, label: string): Promise<IngestResult> {
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
    throw new GameregError('usage', 'error.bad_image', { file: label }, { cause })
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
  return ingestBuffer(vault, input, config, sourcePath)
}

/**
 * Downloads a provider's cover art and runs it through the same pipeline as
 * `--photo` (docs/spec/06-roadmap.md, "enrich, cover download via
 * sharp"). Best-effort: `enrich`'s own contract is that a provider failure
 * never blocks recording (02-cli.md), so a network error or an unparseable
 * response is not thrown — it is `null`, and the caller falls back to storing
 * the bare URL, same as before this existed.
 *
 * `fetchImpl` is injected the same way `providers/igdb.ts` does it, so tests
 * mock at this boundary and never open a socket.
 */
export async function ingestUrl(
  vault: Vault,
  url: string,
  config: Config = vault.config,
  fetchImpl: typeof fetch = fetch,
): Promise<IngestResult | null> {
  let response: Response
  try {
    response = await fetchImpl(url)
  } catch {
    return null
  }
  if (!response.ok) return null

  let input: Buffer
  try {
    input = Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }

  try {
    return await ingestBuffer(vault, input, config, url)
  } catch {
    return null
  }
}
