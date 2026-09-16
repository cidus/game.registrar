/**
 * Every relative link in the repository's Markdown resolves, anchors included.
 *
 * The documentation is a set of pages that point at each other and at the code,
 * and a page moved or a heading renamed breaks those pointers silently: GitHub
 * renders a dead link exactly like a live one. This walks every Markdown file
 * the repository writes by hand, follows each relative link to a file or a
 * directory, and when the link names an anchor checks that the target file has
 * a heading producing it — the same slug GitHub generates.
 *
 * External URLs are not fetched: no network in unit tests.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')

/** Fixtures and generated trees: their links are data, not documentation. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'example-vault', 'quartz'])

function markdownFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...markdownFiles(full))
    else if (entry.name.endsWith('.md')) found.push(full)
  }
  return found
}

/** The file's lines with fenced code blocks blanked, so examples are not read as links or headings. */
function proseLines(text: string): string[] {
  let fence: string | null = null
  return text.split('\n').map((line) => {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker[0] as string
      else if (marker[0] === fence) fence = null
      return ''
    }
    return fence === null ? line : ''
  })
}

/** GitHub's heading slug: rendered text, lowercased, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  const rendered = heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
  return rendered.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-')
}

const anchorCache = new Map<string, Set<string>>()

function anchors(file: string): Set<string> {
  const cached = anchorCache.get(file)
  if (cached !== undefined) return cached
  const found = new Set<string>()
  const counts = new Map<string, number>()
  for (const line of proseLines(readFileSync(file, 'utf8'))) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1]
    if (heading !== undefined) {
      const base = slug(heading)
      const seen = counts.get(base) ?? 0
      counts.set(base, seen + 1)
      found.add(seen === 0 ? base : `${base}-${seen}`)
    }
    for (const match of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) found.add(match[1] as string)
  }
  anchorCache.set(file, found)
  return found
}

function brokenLinks(file: string): string[] {
  const broken: string[] = []
  proseLines(readFileSync(file, 'utf8')).forEach((raw, index) => {
    const line = raw.replace(/`[^`]*`/g, '')
    for (const match of line.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const target = match[1] as string
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      const [path = '', anchor] = target.split('#')
      const resolved = path === '' ? file : join(dirname(file), decodeURIComponent(path))
      const where = `${relative(ROOT, file)}:${index + 1}: ${target}`
      if (!existsSync(resolved)) {
        broken.push(`${where} (no such file)`)
      } else if (anchor !== undefined && anchor !== '' && statSync(resolved).isFile() && resolved.endsWith('.md')) {
        if (!anchors(resolved).has(decodeURIComponent(anchor).toLowerCase())) broken.push(`${where} (no such heading)`)
      }
    }
  })
  return broken
}

test('the slug matches what GitHub generates for the headings this repository uses', () => {
  assert.equal(slug('`gamereg import <file.csv> --mapping <file.json>`'), 'gamereg-import-filecsv---mapping-filejson')
  assert.equal(slug('D9 — Capability is introspectable, never a list the caller keeps'), 'd9--capability-is-introspectable-never-a-list-the-caller-keeps')
  assert.equal(slug('Command name mapping (pt-BR)'), 'command-name-mapping-pt-br')
  assert.equal(slug('`checkin.after`'), 'checkinafter')
})

test('every relative Markdown link resolves to a file, and every anchor to a heading', () => {
  const broken = markdownFiles(ROOT).flatMap(brokenLinks)
  assert.deepEqual(broken, [], `fix the link or the heading it points at\n${broken.join('\n')}`)
})
