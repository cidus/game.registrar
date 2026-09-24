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
import { assetPath } from '../src/render/assets.ts'
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

/** A PNG, so a test can tell "the source extension" from "the stored one". */
async function png(): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 10, b: 60 } } })
    .png()
    .toBuffer()
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

test('keep_original writes a second copy, and EXIF including GPS does not survive into it either', async () => {
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

  const config = { ...DEFAULT_CONFIG, images: { ...DEFAULT_CONFIG.images, keep_original: true } }
  const result = await ingestImage(vault, src, config)

  const originalPath = join(root, 'assets', result.sha256.slice(0, 2), `${result.sha256}.original.jpeg`)
  assert.equal(existsSync(originalPath), true)

  const meta = await sharp(readFileSync(originalPath)).metadata()
  assert.equal(meta.exif, undefined)
  assert.equal(meta.format, 'jpeg')
})

test('keep_original off by default: no .original file is written', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  const src = join(root, 'in.jpg')
  writeFileSync(src, await photo())

  const result = await ingestImage(vault, src)
  const originalPath = join(root, 'assets', result.sha256.slice(0, 2), `${result.sha256}.original.jpeg`)
  assert.equal(existsSync(originalPath), false)
})

/**
 * The pipeline and `render/assets.ts` must not be able to disagree about where
 * an attachment lives. `assetPath()` hardcodes `.webp`; this is what makes that
 * correct rather than lucky, and it fails the moment ingestion is changed to
 * carry a source extension through.
 *
 * Driven from the pipeline, not from a fixture: every fixture in the repository
 * happens to be a WebP already, so no fixture can tell the two readings apart.
 * PNG and JPEG go in; one extension comes out.
 */
test('whatever goes in, the stored file is the .webp that assetPath names', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)

  for (const [name, bytes] of [
    ['in.png', await png()],
    ['in.jpg', await photo({ width: 100 })],
  ] as const) {
    const src = join(root, name)
    writeFileSync(src, bytes)

    const result = await ingestImage(vault, src)
    assert.equal(result.ext, 'webp', name)
    assert.equal(existsSync(join(root, assetPath(result.sha256))), true, `${name}: assetPath names no file`)
    assert.equal((await sharp(readFileSync(join(root, assetPath(result.sha256)))).metadata()).format, 'webp', name)
  }
})

/**
 * `images.keep_original` is the one setting that puts a differently-suffixed
 * file in `assets/`, and it is the reason to check rather than assume: the copy
 * is a *sibling* keyed off the same WebP hash, so the attachment's own path is
 * unchanged and nothing in the log or the derived artifacts names the sibling
 * (01-model.md: `ext` describes the stored bytes "rather than naming a second
 * location").
 */
test('keep_original adds a sibling and does not move where the attachment lives', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  const src = join(root, 'in.png')
  writeFileSync(src, await png())

  const config = { ...DEFAULT_CONFIG, images: { ...DEFAULT_CONFIG.images, keep_original: true } }
  const result = await ingestImage(vault, src, config)

  assert.equal(result.ext, 'webp')
  assert.equal(existsSync(join(root, assetPath(result.sha256))), true)
  // The sibling exists, carries the source format, and is not what `ext` names.
  assert.equal(
    existsSync(join(root, 'assets', result.sha256.slice(0, 2), `${result.sha256}.original.png`)),
    true,
  )
  assert.notEqual(assetPath(result.sha256).endsWith('.original.png'), true)
})

test('a nonexistent source file is a usage error, not a crash', async () => {
  const root = tempDir('gamereg-ingest-')
  const vault = vaultAt(root)
  await assert.rejects(ingestImage(vault, join(root, 'missing.jpg')))
})
