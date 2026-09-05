/**
 * Phase numbers are cited in exactly one place, and this is what keeps it true.
 *
 * They are the one label in this project designed to move: reordering them is a
 * product decision, not a rename. Moving distribution ahead of board games made
 * `src/core/fold.ts`, `01-model.md` and `agent/PERSONAS.md` wrong in a single
 * commit, all three of them saying "phase 4" about work that was no longer
 * there.
 *
 * The rule is narrower than "never say a number", because the first draft of it
 * was violated by the commit that introduced it. A *narrative* document —
 * CLAUDE.md, CHANGELOG.md, agent/README.md, a tag message — is telling the
 * story of when something happened, and "shipped in phase 3" stays true through
 * a renumbering because it is a claim about history. A comment in `fold.ts`
 * saying a field is for phase 4 is a forward reference, and forward references
 * rot. So: no phase number in code, and none in a spec other than the roadmap
 * that owns them.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const CITATION = /\bphases?[\s-](\d+)\b/i

/** Every file under `dir` with one of `extensions`, recursively. */
function walk(dir: string, extensions: string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(full, extensions))
    else if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(full)
  }
  return found
}

function citations(files: string[]): string[] {
  const hits: string[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (CITATION.test(line)) hits.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`)
    })
  }
  return hits
}

test('no source file cites a roadmap phase by number', () => {
  const hits = citations(walk(join(ROOT, 'src'), ['.ts']))
  assert.deepEqual(hits, [], `say what the work is; the roadmap owns where it sits\n${hits.join('\n')}`)
})

test('no spec but the roadmap cites a phase by number', () => {
  const specs = walk(join(ROOT, 'docs', 'spec'), ['.md']).filter((f) => !f.endsWith('06-roadmap.md'))
  const hits = citations(specs)
  assert.deepEqual(hits, [], `a spec describes the system, not the plan\n${hits.join('\n')}`)
})

test('the roadmap does cite them, since it is the document that owns them', () => {
  // The complement, so this pair cannot both pass by the numbers having
  // vanished everywhere.
  assert.ok(CITATION.test(readFileSync(join(ROOT, 'docs', 'spec', '06-roadmap.md'), 'utf8')))
})
