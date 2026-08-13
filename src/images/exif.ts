/**
 * Reading `captured_at` out of EXIF, before it is discarded
 * (docs/spec/04-derived.md "EXIF is read, then stripped").
 *
 * Deliberately minimal: this is not a general EXIF reader, it extracts one
 * ASCII tag — `DateTimeOriginal` from the Exif sub-IFD, falling back to the
 * top-level `DateTime` — and nothing else. GPS and every other tag are never
 * even looked at here; they are discarded wholesale by the normalize step
 * (`images/ingest.ts`) simply by never being carried into the output.
 */

const TIFF_HEADER = Buffer.from('Exif\0\0')

const TAG_EXIF_IFD_POINTER = 0x8769
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_DATE_TIME = 0x0132
const TYPE_ASCII = 2

type Reader = {
  buffer: Buffer
  littleEndian: boolean
  base: number
}

function u16(reader: Reader, offset: number): number {
  return reader.littleEndian ? reader.buffer.readUInt16LE(offset) : reader.buffer.readUInt16BE(offset)
}

function u32(reader: Reader, offset: number): number {
  return reader.littleEndian ? reader.buffer.readUInt32LE(offset) : reader.buffer.readUInt32BE(offset)
}

/** One 12-byte IFD entry: tag, type, count, then either the value or an offset to it. */
function readAsciiTag(reader: Reader, ifdOffset: number, wanted: number): string | null {
  const absoluteIfd = reader.base + ifdOffset
  if (absoluteIfd + 2 > reader.buffer.length) return null
  const count = u16(reader, absoluteIfd)

  for (let index = 0; index < count; index += 1) {
    const entry = absoluteIfd + 2 + index * 12
    if (entry + 12 > reader.buffer.length) break
    const tag = u16(reader, entry)
    if (tag !== wanted) continue
    const type = u16(reader, entry + 2)
    if (type !== TYPE_ASCII) return null
    const length = u32(reader, entry + 4)
    const dataOffset = length <= 4 ? entry + 8 : reader.base + u32(reader, entry + 8)
    if (dataOffset + length > reader.buffer.length) return null
    const raw = reader.buffer.subarray(dataOffset, dataOffset + length).toString('ascii')
    return raw.replace(/\0+$/, '')
  }
  return null
}

function findExifIfdOffset(reader: Reader, ifd0Offset: number): number | null {
  const absoluteIfd = reader.base + ifd0Offset
  if (absoluteIfd + 2 > reader.buffer.length) return null
  const count = u16(reader, absoluteIfd)
  for (let index = 0; index < count; index += 1) {
    const entry = absoluteIfd + 2 + index * 12
    if (entry + 12 > reader.buffer.length) break
    if (u16(reader, entry) === TAG_EXIF_IFD_POINTER) return u32(reader, entry + 8)
  }
  return null
}

/** `"2026:08:12 20:14:03"` → `"2026-08-12T20:14:03"`. No offset in EXIF, so no zone is assumed here. */
function toIso(value: string): string | null {
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (match === null) return null
  const [, y, mo, d, h, mi, s] = match
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}

/**
 * `exifBuffer` is `sharp(...).metadata().exif` — the raw APP1 payload sharp
 * exposes before anything strips it. Returns null on anything malformed or
 * absent; a photo with no readable timestamp is not an error, just no
 * suggestion.
 */
export function readCapturedAt(exifBuffer: Buffer | undefined): string | null {
  if (exifBuffer === undefined || exifBuffer.length < TIFF_HEADER.length + 8) return null
  if (!exifBuffer.subarray(0, TIFF_HEADER.length).equals(TIFF_HEADER)) return null

  const tiffStart = TIFF_HEADER.length
  const byteOrder = exifBuffer.subarray(tiffStart, tiffStart + 2).toString('ascii')
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null

  const reader: Reader = { buffer: exifBuffer, littleEndian: byteOrder === 'II', base: tiffStart }
  const magic = u16(reader, tiffStart + 2)
  if (magic !== 42) return null

  const ifd0Offset = u32(reader, tiffStart + 4)

  const exifIfdOffset = findExifIfdOffset(reader, ifd0Offset)
  const original = exifIfdOffset === null ? null : readAsciiTag(reader, exifIfdOffset, TAG_DATE_TIME_ORIGINAL)
  const fallback = original ?? readAsciiTag(reader, ifd0Offset, TAG_DATE_TIME)
  if (fallback === null) return null

  return toIso(fallback)
}
