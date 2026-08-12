/**
 * The marker protocol (docs/spec/04-derived.md).
 *
 *   <!-- gamereg:begin block=sessions -->
 *   ...generated...
 *   <!-- gamereg:end block=sessions -->
 *
 * Markers are located through the Markdown AST — so a marker inside a fenced
 * code block is text, not a marker — and the splice is then done on the raw
 * source by offset. Nothing outside a marker pair is re-serialized, which is
 * how "byte-identical outside markers" is achieved rather than hoped for.
 */
import remarkFrontmatter from 'remark-frontmatter'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Root, RootContent } from 'mdast'

import { GameregError } from '../core/errors.ts'

const MARKER = /<!--\s*gamereg:(begin|end)\s+block=([a-z0-9_-]+)\s*-->/gi

const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml'])

export type Marker = {
  kind: 'begin' | 'end'
  block: string
  /** Absolute offsets of the comment itself, in the source string. */
  start: number
  end: number
}

export type Region = {
  block: string
  /** Offset just after the begin marker, and just before the end marker. */
  contentStart: number
  contentEnd: number
  /** Offsets of the whole region, markers included. */
  start: number
  end: number
}

export function parseMarkdown(source: string): Root {
  return processor.parse(source)
}

export function findMarkers(source: string): Marker[] {
  const tree = parseMarkdown(source)
  const markers: Marker[] = []

  visit(tree, 'html', (node) => {
    const offset = node.position?.start.offset
    if (offset === undefined) return
    MARKER.lastIndex = 0
    for (let match = MARKER.exec(node.value); match !== null; match = MARKER.exec(node.value)) {
      markers.push({
        kind: (match[1] ?? '').toLowerCase() === 'begin' ? 'begin' : 'end',
        block: (match[2] ?? '').toLowerCase(),
        start: offset + match.index,
        end: offset + match.index + match[0].length,
      })
    }
  })

  return markers.sort((left, right) => left.start - right.start)
}

/** Validated pairs. An unpaired or nested marker is a hard error, never a guess. */
export function findRegions(source: string, file: string): Region[] {
  const regions: Region[] = []
  let open: Marker | null = null

  for (const marker of findMarkers(source)) {
    if (marker.kind === 'begin') {
      if (open !== null) {
        throw new GameregError('error', 'error.marker_nested', { file, block: marker.block })
      }
      open = marker
      continue
    }
    if (open === null || open.block !== marker.block) {
      throw new GameregError('error', 'error.marker_unopened', { file, block: marker.block })
    }
    regions.push({
      block: marker.block,
      contentStart: open.end,
      contentEnd: marker.start,
      start: open.start,
      end: marker.end,
    })
    open = null
  }

  if (open !== null) {
    throw new GameregError('error', 'error.marker_unpaired', { file, block: open.block })
  }
  return regions
}

export function beginMarker(block: string): string {
  return `<!-- gamereg:begin block=${block} -->`
}

export function endMarker(block: string): string {
  return `<!-- gamereg:end block=${block} -->`
}

export function wrapBlock(block: string, content: string): string {
  const body = content.trim()
  return body === ''
    ? `${beginMarker(block)}\n${endMarker(block)}`
    : `${beginMarker(block)}\n${body}\n${endMarker(block)}`
}

export type BlockContent = {
  block: string
  content: string
  /** Heading written above the block when it has to be appended. */
  heading?: string | undefined
  /**
   * Whether a block absent from the note should be created. False for blocks
   * that only exist once there is something to say: an empty heading in every
   * note is noise, while an existing block is still emptied rather than left
   * holding what it used to say (04-derived, rule 6).
   */
  appendWhenMissing?: boolean | undefined
}

/**
 * Replaces the inside of every known block, and appends the missing ones at the
 * end in canonical order. Bytes outside the markers are copied verbatim.
 */
export function spliceBlocks(source: string, blocks: readonly BlockContent[], file: string): string {
  const regions = findRegions(source, file)
  const byBlock = new Map(blocks.map((entry) => [entry.block, entry]))

  let output = source
  // Right to left, so earlier offsets stay valid as we rewrite.
  for (const region of [...regions].reverse()) {
    const entry = byBlock.get(region.block)
    if (entry === undefined) continue
    const body = entry.content.trim()
    const replacement = body === '' ? '\n' : `\n${body}\n`
    output = output.slice(0, region.contentStart) + replacement + output.slice(region.contentEnd)
  }

  const present = new Set(regions.map((region) => region.block))
  const missing = blocks.filter(
    (entry) =>
      !present.has(entry.block) &&
      entry.appendWhenMissing !== false &&
      entry.content.trim() !== '',
  )
  if (missing.length > 0) {
    const tail = missing
      .map((entry) =>
        entry.heading === undefined
          ? wrapBlock(entry.block, entry.content)
          : `## ${entry.heading}\n\n${wrapBlock(entry.block, entry.content)}`,
      )
      .join('\n\n')
    const separator = output === '' ? '' : output.endsWith('\n') ? '\n' : '\n\n'
    output = `${output}${separator}${tail}\n`
  }

  return output
}

export function frontmatterRange(source: string): { start: number; end: number } | null {
  const tree = parseMarkdown(source)
  const first: RootContent | undefined = tree.children[0]
  if (first === undefined || first.type !== 'yaml') return null
  const start = first.position?.start.offset
  const end = first.position?.end.offset
  if (start === undefined || end === undefined) return null
  return { start, end }
}
