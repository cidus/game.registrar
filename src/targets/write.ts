/**
 * Applying a planned file to disk (docs/spec/07-targets.md "Write policies").
 *
 * Every filesystem decision lives here, and none of it lives in a target: a
 * target says what the file should contain and how it is owned, the writer
 * decides whether that means overwriting, splicing or leaving well alone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { vaultPath, type Vault } from '../core/vault.ts'
import { frontmatterRange, spliceBlocks } from '../render/markers.ts'
import type { PlannedFile, SplicePlan } from './types.ts'

export function read(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

/** LF endings, no trailing whitespace, exactly one trailing newline. */
export function canonical(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
  return `${normalized.replace(/\n+$/, '')}\n`
}

/** True when the file changed. Unchanged files are left alone, mtime included. */
function writeIfChanged(file: string, content: string | Buffer, force: boolean): boolean {
  mkdirSync(dirname(file), { recursive: true })

  if (typeof content !== 'string') {
    if (!force && existsSync(file) && readFileSync(file).equals(content)) return false
    writeFileSync(file, content)
    return true
  }

  const next = canonical(content)
  if (!force && read(file) === next) return false
  writeFileSync(file, next, 'utf8')
  return true
}

/**
 * Splices the generated regions into a note that already exists. Bytes outside
 * the markers are copied verbatim; the frontmatter is regenerated wholesale.
 */
export function spliceInto(existing: string, parts: SplicePlan, file: string): string {
  const spliced = spliceBlocks(existing, parts.blocks, file)
  if (parts.frontmatter === null) {
    return spliced.endsWith('\n') ? spliced : `${spliced}\n`
  }

  const range = frontmatterRange(spliced)
  const yaml = `---\n${parts.frontmatter}\n---`
  const withFrontmatter =
    range === null
      ? `${yaml}\n\n${spliced.replace(/^\n+/, '')}`
      : spliced.slice(0, range.start) + yaml + spliced.slice(range.end)

  return withFrontmatter.endsWith('\n') ? withFrontmatter : `${withFrontmatter}\n`
}

/** Applies one planned file. Returns true when bytes were written. */
export function applyFile(vault: Vault, planned: PlannedFile, force: boolean): boolean {
  const file = vaultPath(vault, planned.path)

  if (planned.policy === 'seed') {
    // Existence, not content: the moment a base is edited it is the user's.
    if (existsSync(file) && !force) return false
    return writeIfChanged(file, planned.content, force)
  }

  if (planned.policy === 'splice' && planned.parts !== undefined) {
    const existing = read(file)
    if (existing !== null && existing.trim() !== '') {
      return writeIfChanged(file, spliceInto(existing, planned.parts, planned.path), force)
    }
  }

  return writeIfChanged(file, planned.content, force)
}
