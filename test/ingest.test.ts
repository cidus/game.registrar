/**
 * The image ingestion pipeline (docs/spec/04-derived.md "Image ingestion").
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

import { DEFAULT_CONFIG } from '../src/core/config.ts'
import { openVault } from '../src/core/vault.ts'
import { ingestImage } from '../src/images/ingest.ts'
import { tempDir } from './helpers.ts'

async function photo(options: {
  width?: number
  exif?: Record<string, Record<string, string>>
} = {}): Promise<Buffer> {
  let pipeline = sharp({
    create: { width: options.width ?? 4000, height: (options.width ?? 4000) / 2, channels: 3, background: { r: 10, g: 200, b: 30 } },
  })
  if (options.exif !== undefined) pipeline = pipeline.withExif(options.exif)
  return pipeline.jpeg().toBuffer()
}

function vaultAt(root: string) {
  return openVault(root)
}

test('normalizes to WebP, resized within max_edge, and writes assets/<sha[0:2]>/<sha>.webp', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  const src = join(root, 'in.jpg')
  writeFileSync(src, await photo({ width: 4000 }))

  const result = await ingestImage(vault, src)
  assert.equal(result.ext, 'webp')
  assert.equal(result.written, true)
  assert.match(result.sha256, /^[0-9a-f]{64}$/)

  const written = join(root, 'assets', result.sha256.slice(0, 2), `${result.sha256}.webp`)
  assert.equal(existsSync(written), true)

  const meta = await sharp(readFileSync(written)).metadata()
  assert.equal(meta.format, 'webp')
  assert.ok(Math.max(meta.width ?? 0, meta.height ?? 0) <= DEFAULT_CONFIG.images.max_edge)
})

test('re-ingesting the same photo is a no-op: same hash, no second write', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  const src = join(root, 'in.jpg')
  writeFileSync(src, await photo())

  const first = await ingestImage(vault, src)
  assert.equal(first.written, true)

  const second = await ingestImage(vault, src)
  assert.equal(second.sha256, first.sha256)
  assert.equal(second.written, false)
})

test('EXIF, including GPS, does not survive into the output', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  const src = join(root, 'in.jpg')
  writeFileSync(
    src,
    await photo({
      exif: {
        IFD2: { DateTimeOriginal: '2026:08:12 20:14:03' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 0/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '20/1 0/1 0/1' },
      },
    }),
  )

  const result = await ingestImage(vault, src)
  const written = join(root, 'assets', result.sha256.slice(0, 2), `${result.sha256}.webp`)
  const meta = await sharp(readFileSync(written)).metadata()
  assert.equal(meta.exif, undefined)
})

test('captured_at is suggested from EXIF DateTimeOriginal, never applied silently', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  const src = join(root, 'in.jpg')
  writeFileSync(src, await photo({ exif: { IFD2: { DateTimeOriginal: '2026:08:12 20:14:03' } } }))

  const result = await ingestImage(vault, src)
  assert.equal(result.captured_at, '2026-08-12T20:14:03')
})

test('a photo with no EXIF has a null captured_at, not an error', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  const src = join(root, 'in.jpg')
  writeFileSync(src, await photo())

  const result = await ingestImage(vault, src)
  assert.equal(result.captured_at, null)
})

test('a nonexistent source file is a usage error, not a crash', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  await assert.rejects(ingestImage(vault, join(root, 'missing.jpg')))
})
