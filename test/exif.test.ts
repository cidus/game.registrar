/**
 * `readCapturedAt` (docs/spec/04-derived.md "EXIF is read, then stripped").
 * Synthetic EXIF built with sharp itself, so no binary fixture is needed.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'

import { readCapturedAt } from '../src/images/exif.ts'

async function exifOf(withExif: Record<string, Record<string, string>>): Promise<Buffer | undefined> {
  const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 0, b: 0 } } })
    .withExif(withExif)
    .jpeg()
    .toBuffer()
  return (await sharp(buffer).metadata()).exif
}

test('reads DateTimeOriginal from the Exif sub-IFD', async () => {
  const exif = await exifOf({ IFD2: { DateTimeOriginal: '2026:08:12 20:14:03' } })
  assert.equal(readCapturedAt(exif), '2026-08-12T20:14:03')
})

test('falls back to IFD0 DateTime when there is no DateTimeOriginal', async () => {
  const exif = await exifOf({ IFD0: { DateTime: '2020:01:02 03:04:05' } })
  assert.equal(readCapturedAt(exif), '2020-01-02T03:04:05')
})

test('a photo with no EXIF at all returns null, not an error', () => {
  assert.equal(readCapturedAt(undefined), null)
})

test('EXIF present but with no readable date tag returns null', async () => {
  const exif = await exifOf({ IFD0: { Make: 'TestCam' } })
  assert.equal(readCapturedAt(exif), null)
})

test('a malformed buffer never throws', () => {
  assert.equal(readCapturedAt(Buffer.from('not exif at all')), null)
  assert.equal(readCapturedAt(Buffer.alloc(0)), null)
})
