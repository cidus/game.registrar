/**
 * The agent's CLI reference is a promise made to a model that cannot check it
 * (agent/skills/gamereg/reference/cli.md). A flag named there and absent from
 * the binary produces an invocation that fails in a chat, months later, with
 * nobody at a terminal to read the error.
 *
 * So: every `gamereg …` line in a fenced block of that file is parsed, and
 * every command and flag in it has to exist. This is the golden-file idea
 * pointed at prose instead of output.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { Command } from 'commander'

import { translator } from '../src/i18n/index.ts'
import { createRegistrar, withGlobals } from '../src/cli/register.ts'
import { registerAlias } from '../src/cli/commands/alias.ts'
import { registerAmend } from '../src/cli/commands/amend.ts'
import { registerAttach } from '../src/cli/commands/attach.ts'
import { registerBreak } from '../src/cli/commands/break.ts'
import { registerBuild } from '../src/cli/commands/build.ts'
import { registerCover } from '../src/cli/commands/cover.ts'
import { registerDoctor } from '../src/cli/commands/doctor.ts'
import { registerDrop } from '../src/cli/commands/drop.ts'
import { registerEnd } from '../src/cli/commands/end.ts'
import { registerEnrich } from '../src/cli/commands/enrich.ts'
import { registerFinish } from '../src/cli/commands/finish.ts'
import { registerImport } from '../src/cli/commands/import.ts'
import { registerInit } from '../src/cli/commands/init.ts'
import { registerOpen } from '../src/cli/commands/open.ts'
import { registerPast } from '../src/cli/commands/past.ts'
import { registerPlatform } from '../src/cli/commands/platform.ts'
import { registerQuery } from '../src/cli/commands/query.ts'
import { registerSearch } from '../src/cli/commands/search.ts'
import { registerStart } from '../src/cli/commands/start.ts'
import { registerStatus } from '../src/cli/commands/status.ts'
import { registerVerdict } from '../src/cli/commands/verdict.ts'
import { registerVocab } from '../src/cli/commands/vocab.ts'

const SKILL = join(import.meta.dirname, '..', 'agent', 'skills', 'gamereg')

function program(): Command {
  const { t } = translator('en')
  const command = withGlobals(new Command('gamereg'), t)
  const registrar = createRegistrar(command, t)
  for (const register of [
    registerInit,
    registerStart,
    registerEnd,
    registerBreak,
    registerFinish,
    registerDrop,
    registerPast,
    registerOpen,
    registerStatus,
    registerVerdict,
    registerSearch,
    registerPlatform,
    registerAlias,
    registerAmend,
    registerAttach,
    registerCover,
    registerBuild,
    registerDoctor,
    registerEnrich,
    registerQuery,
    registerVocab,
    registerImport,
  ]) {
    register(registrar)
  }
  return command
}

/** Walks `gamereg a b --c` down the command tree, ignoring `<args>`. */
function locate(root: Command, path: string[]): Command | null {
  let current = root
  for (const name of path) {
    const child = current.commands.find(
      (candidate) => candidate.name() === name || candidate.aliases().includes(name),
    )
    if (child === undefined) return null
    current = child
  }
  return current
}

function knownFlags(command: Command): Set<string> {
  const flags = new Set<string>(['--help'])
  for (const option of command.options) {
    if (option.long !== undefined && option.long !== null) flags.add(option.long)
    // `--no-metadata` is declared as a negated boolean; both spellings are real.
    if (option.long?.startsWith('--no-') === true) flags.add(`--${option.long.slice(5)}`)
  }
  return flags
}

/** Every `gamereg …` line inside a fenced block, as (command path, flags). */
function invocations(markdown: string): { line: string; path: string[]; flags: string[] }[] {
  const out: { line: string; path: string[]; flags: string[] }[] = []
  let fenced = false
  for (const raw of markdown.split('\n')) {
    if (raw.trimStart().startsWith('```')) {
      fenced = !fenced
      continue
    }
    const line = raw.trim()
    if (!fenced || !line.startsWith('gamereg ')) continue

    const tokens = line.split(/\s+/).slice(1)
    const path: string[] = []
    const flags: string[] = []
    for (const token of tokens) {
      if (token.startsWith('--')) flags.push(token)
      else if (flags.length === 0 && !token.startsWith('<') && !token.startsWith('[')) path.push(token)
    }
    out.push({ line, path, flags })
  }
  return out
}

test('every command the agent reference names exists in the CLI', () => {
  const root = program()
  const reference = readFileSync(join(SKILL, 'reference', 'cli.md'), 'utf8')
  const found = invocations(reference)

  assert.ok(found.length > 15, `parsed only ${found.length} invocations — the format changed`)

  for (const { line, path } of found) {
    if (path.length === 0) continue // the global-flags line
    assert.notEqual(locate(root, path), null, `no such command: ${line}`)
  }
})

test('every flag the agent reference names exists on the command it names it under', () => {
  const root = program()
  const reference = readFileSync(join(SKILL, 'reference', 'cli.md'), 'utf8')

  for (const { line, path, flags } of invocations(reference)) {
    const command = path.length === 0 ? root : locate(root, path)
    if (command === null) continue // reported by the test above
    const known = knownFlags(command)
    for (const flag of flags) {
      assert.ok(known.has(flag), `${flag} does not exist on "${path.join(' ') || 'gamereg'}": ${line}`)
    }
  }
})

/**
 * The skill is authored in one language, English, and localization is the CLI's
 * job (docs/spec/05-agent.md "Language"). The failure this guards against is
 * gradual and reasonable-looking: someone deploys against a Portuguese-speaking
 * user, pastes the phrasings that user actually types as examples, and the
 * prompt slowly becomes a glossary competing with i18n/ that nothing validates.
 *
 * Typographic punctuation the prose already uses is allowed; letters outside
 * ASCII are not.
 */
test('the skill and its references are written in English, with no phrasebook', () => {
  const allowed = /[—–…‘’“” →×≤≥]/g

  for (const file of ['SKILL.md', join('reference', 'cli.md'), join('reference', 'query.md')]) {
    const text = readFileSync(join(SKILL, file), 'utf8').replace(allowed, '')
    const lines = text.split('\n')
    for (const [index, line] of lines.entries()) {
      const offending = line.match(/[^\x00-\x7F]/g)
      assert.equal(
        offending,
        null,
        `${file}:${index + 1} carries non-ASCII text (${offending?.join('')}) — the skill is English, ` +
          `and the register's localized vocabulary belongs to i18n/, not to the prompt: ${line.trim()}`,
      )
    }
  }
})

/**
 * `query`'s SQL is a positional argument (`gamereg query "SELECT …" --json`),
 * never a `--sql` flag — that flag has never existed. The command/flag checks
 * above only read reference/cli.md, which documents `query` with a `<sql>`
 * placeholder rather than a literal query, so a `--sql` typo baked directly
 * into SKILL.md's own prose survived undetected and was copied by the agent
 * into a real invocation more than once, live. This targets that one
 * confirmed mistake directly rather than teaching the generic tokenizer above
 * to parse quoted SQL as command-path segments.
 */
test('no gamereg query example invents a --sql flag', () => {
  for (const file of ['SKILL.md', join('reference', 'cli.md'), join('reference', 'query.md')]) {
    const text = readFileSync(join(SKILL, file), 'utf8')
    assert.doesNotMatch(text, /gamereg query --sql\b/, `${file} shows "gamereg query --sql" — the SQL is positional, there is no --sql flag`)
  }
})

test('the skill declares the binary it cannot run without', () => {
  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  const frontmatter = skill.split('---')[1] ?? ''
  assert.match(frontmatter, /^name: gamereg$/m)
  assert.match(frontmatter, /^description: /m)
  assert.match(frontmatter, /"bins": \["gamereg"\]/)
})

/**
 * The reaction tokens are a closed list of five identifiers, written down in
 * three places: the spec, the skill the model reads, and the mapping table a
 * deployment fills in (docs/spec/05-agent.md, "Reactions"). Nothing at runtime
 * catches a disagreement between them — an unmapped token resolves to nothing,
 * silently, which is also what a correct empty installation looks like.
 */
const REACTION_TOKENS = ['filed', 'approved', 'archived', 'pending', 'puzzled']

/** The `| `token` | ... |` rows of the first table under a heading. */
function tokenRows(markdown: string, heading: string): { token: string; cells: string[] }[] {
  const body = markdown.split(heading)[1] ?? ''
  const rows: { token: string; cells: string[] }[] = []
  for (const line of body.split('\n')) {
    if (!line.startsWith('|')) {
      if (rows.length > 0) break // past the table
      continue
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    const token = cells[0]?.replace(/`/g, '') ?? ''
    if (REACTION_TOKENS.includes(token)) rows.push({ token, cells: cells.slice(1) })
  }
  return rows
}

test('the skill names the five reaction tokens and no others', () => {
  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  const rows = tokenRows(skill, '\n## Reactions\n')
  assert.deepEqual(
    rows.map((row) => row.token),
    REACTION_TOKENS,
    'the token table in SKILL.md drifted from the closed list in docs/spec/05-agent.md',
  )
})

test('the shipped mapping table covers every token, and ships no sticker', () => {
  const workspace = join(import.meta.dirname, '..', 'agent', 'workspace', 'REACTIONS.md')
  const rows = tokenRows(readFileSync(workspace, 'utf8'), '\n## The table\n')

  assert.deepEqual(
    rows.map((row) => row.token),
    REACTION_TOKENS,
    'REACTIONS.md and SKILL.md disagree about which tokens exist',
  )

  // No artwork ships here: the sticker set is per installation, and a file_id
  // committed to this repository would be one bot's, forever wrong elsewhere.
  // The emoji column is not an asset and may ship with a default.
  for (const { token, cells } of rows) {
    assert.equal(cells[0], '', `REACTIONS.md ships a sticker file_id for "${token}"`)
  }
})
