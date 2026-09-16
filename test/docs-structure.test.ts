/**
 * The documentation's own bookkeeping.
 *
 * Decision records are only useful if they can be found and cited: each one is
 * numbered once, dated, carries a status, and appears in the index a reader
 * starts from. And a page nobody links to is a page nobody reads, so every page
 * under docs/ is reachable from the documentation map. Both lists are written by
 * hand, which is exactly why they need a test holding them to the files.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'

const DOCS = join(import.meta.dirname, '..', 'docs')
const DECISIONS = join(DOCS, 'decisions')
const RECORD = /^(\d{4})-[a-z0-9-]+\.md$/

/** Every Markdown file under `dir`, recursively. */
function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return pages(full)
    return entry.name.endsWith('.md') ? [full] : []
  })
}

/** The files a Markdown page links to, resolved against its own folder, anchors dropped. */
function linkedFiles(page: string): Set<string> {
  const text = readFileSync(page, 'utf8')
  const found = new Set<string>()
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>#]+)[^)]*\)/g)) {
    const target = match[1] as string
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    found.add(resolve(dirname(page), decodeURIComponent(target)))
  }
  return found
}

function records(): string[] {
  return readdirSync(DECISIONS).filter((name) => RECORD.test(name)).sort()
}

test('decision records are numbered from 0001 with no gap and no repeat', () => {
  const numbers = records().map((name) => Number(RECORD.exec(name)?.[1]))
  assert.ok(numbers.length > 0, 'docs/decisions/ holds no record')
  assert.deepEqual(numbers, numbers.map((_, index) => index + 1))
})

test('every decision record opens with its own number and carries a status and a date', () => {
  for (const name of records()) {
    const text = readFileSync(join(DECISIONS, name), 'utf8')
    const number = name.slice(0, 4)
    assert.match(text, new RegExp(`^# ${number}\\. \\S`), `${name}: the title is "# ${number}. <title>"`)
    assert.match(text, /^- \*\*Status:\*\* \S/m, `${name}: no "- **Status:**" line`)
    assert.match(text, /^- \*\*Date:\*\* \d{4}-\d{2}-\d{2}$/m, `${name}: no "- **Date:** YYYY-MM-DD" line`)
  }
})

test('the decision index links every record', () => {
  const linked = linkedFiles(join(DECISIONS, 'README.md'))
  const missing = records().filter((name) => !linked.has(join(DECISIONS, name)))
  assert.deepEqual(missing, [], 'add these to docs/decisions/README.md')
})

test('the documentation map reaches every page under docs/', () => {
  const map = join(DOCS, 'README.md')
  const linked = linkedFiles(map)
  const orphans = pages(DOCS)
    .filter((page) => page !== map && !RECORD.test(relative(DECISIONS, page)))
    .filter((page) => !linked.has(page))
    .map((page) => relative(DOCS, page))
  assert.deepEqual(orphans, [], 'link these from docs/README.md')
})
