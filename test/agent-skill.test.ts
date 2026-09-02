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
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { test } from 'node:test'

import { Command } from 'commander'

import { SCHEMA_SQL } from '../src/db/schema.ts'
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
const WORKSPACE = join(import.meta.dirname, '..', 'agent', 'workspace')

/**
 * Every file the model actually reads, discovered rather than listed. The list
 * used to be three hardcoded names, which was fine while the skill was one
 * file; splitting the rare flows into their own `reference/` files made a
 * hardcoded list a way to add a prompt file that silently inherits none of the
 * checks below. `AGENTS.md` is in here because it stopped being a page of
 * standing orders and became the operating card that carries the common path.
 */
function promptFiles(): { name: string; text: string }[] {
  const files = [
    { name: 'workspace/AGENTS.md', path: join(WORKSPACE, 'AGENTS.md') },
    { name: 'workspace/SOUL.md', path: join(WORKSPACE, 'SOUL.md') },
    { name: 'SKILL.md', path: join(SKILL, 'SKILL.md') },
    ...readdirSync(join(SKILL, 'reference'))
      .filter((entry) => entry.endsWith('.md'))
      .sort()
      .map((entry) => ({ name: join('reference', entry), path: join(SKILL, 'reference', entry) })),
  ]
  return files.map(({ name, path }) => ({ name, text: readFileSync(path, 'utf8') }))
}

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

    // Quoted arguments are removed whole before tokenizing: they can contain
    // spaces ("<session.open id>", "hollow knight"), so splitting first leaves
    // their tail looking like a bare command-path segment. Only reference/cli.md
    // used to be scanned and it writes bare placeholders; the flow files write
    // invocations the way the agent will actually type them, quotes included.
    const tokens = line
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, "''")
      .split(/\s+/)
      .slice(1)
    const path: string[] = []
    const flags: string[] = []
    for (const token of tokens) {
      if (token.startsWith('--')) flags.push(token)
      // A placeholder (`<query>`, `[query]`) or a quoted token ("hollow knight",
      // "<run.open id>") is an argument, never a command-path segment. Quoting
      // used to be irrelevant because only reference/cli.md was scanned and it
      // writes bare placeholders; the flow files write invocations the way the
      // agent will actually type them, quotes included.
      else if (flags.length === 0 && !/^["'<[]/.test(token)) path.push(token)
      // (a placeholder or a collapsed quoted argument is never a path segment)
    }
    out.push({ line, path, flags })
  }
  return out
}

test('every command the agent prompt names exists in the CLI', () => {
  const root = program()
  let total = 0

  for (const { name: file, text } of promptFiles()) {
    const found = invocations(text)
    total += found.length
    for (const { line, path } of found) {
      if (path.length === 0) continue // the global-flags line
      assert.notEqual(locate(root, path), null, `${file}: no such command: ${line}`)
    }
  }

  assert.ok(total > 25, `parsed only ${total} invocations across the prompt — the format changed`)
})

test('every flag the agent prompt names exists on the command it names it under', () => {
  const root = program()

  for (const { name: file, text } of promptFiles()) {
    for (const { line, path, flags } of invocations(text)) {
      const command = path.length === 0 ? root : locate(root, path)
      if (command === null) continue // reported by the test above
      const known = knownFlags(command)
      for (const flag of flags) {
        assert.ok(known.has(flag), `${file}: ${flag} does not exist on "${path.join(' ') || 'gamereg'}": ${line}`)
      }
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

  for (const { name: file, text: raw } of promptFiles()) {
    const text = raw.replace(allowed, '')
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
  for (const { name: file, text } of promptFiles()) {
    assert.doesNotMatch(text, /gamereg query --sql\b/, `${file} shows "gamereg query --sql" — the SQL is positional, there is no --sql flag`)
  }
})

/**
 * The prompt is a hot card plus branch files now: `AGENTS.md` is in context on
 * every turn and routes to `reference/*.md`, which are read on demand. A route
 * that names a file which does not exist costs a wasted tool call and, worse,
 * a model improvising the procedure it could not load. Nothing at runtime
 * reports it — a failed read just comes back empty.
 */
/**
 * The prompt has a budget, and this test is the budget.
 *
 * `agent/workspace/*.md` is compiled into the system prompt on every turn, so
 * every byte in it is paid for continuously, by every conversation, forever.
 * That is exactly the pressure that grew the old `SKILL.md` to 56KB: no single
 * correction was wrong, each one added a paragraph, and nothing ever measured
 * the total. The failure mode is invisible per-commit and obvious in
 * aggregate.
 *
 * So the ceiling is asserted rather than intended. Raising it is allowed and
 * is meant to be a decision someone makes on purpose, in a diff, with the
 * number in front of them — not something that happens by accumulation. If
 * this fails, the first question is what can come out, and the second is
 * whether the new material belongs in a `reference/` file (read only when its
 * flow happens) or in `agent/README.md` (the deployment log, read by people).
 */
test('the always-loaded workspace stays inside its budget', () => {
  const BUDGET = 30_000

  const files = readdirSync(WORKSPACE)
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => ({ entry, bytes: Buffer.byteLength(readFileSync(join(WORKSPACE, entry), 'utf8')) }))

  const total = files.reduce((sum, file) => sum + file.bytes, 0)
  const breakdown = files.map((file) => `${file.entry} ${file.bytes}`).join(', ')

  assert.ok(
    total <= BUDGET,
    `the always-loaded workspace is ${total} bytes, over the ${BUDGET} budget (${breakdown}). ` +
      `Take something out, move it to a reference/ file or to agent/README.md, ` +
      `or raise the budget deliberately and say why.`,
  )
})

test('every reference file the prompt routes to actually exists', () => {
  const present = new Set(readdirSync(join(SKILL, 'reference')).filter((entry) => entry.endsWith('.md')))
  assert.ok(present.size >= 3, 'the reference directory is suspiciously empty')

  const routed = new Set<string>()
  for (const { name: file, text } of promptFiles()) {
    for (const [, target] of text.matchAll(/reference\/([a-z-]+\.md)/g)) {
      routed.add(target!)
      assert.ok(present.has(target!), `${file} routes to reference/${target}, which does not exist`)
    }
  }

  for (const entry of present) {
    assert.ok(routed.has(entry), `reference/${entry} exists but nothing routes to it — it will never be read`)
  }
})

/**
 * `reference/query.md` lists every table and view with its columns so the agent
 * does not have to guess one. Both halves of that were learned the same way,
 * one release apart: first `FROM v_sessions`, a table that does not exist, and
 * then — once the tables were listed and the views still were not —
 * `SUM(minutes)` over `v_sessions_by_day`, which is already aggregated and
 * carries `hours`. Each cost the user a visible exit 2.
 *
 * A list copied out of the schema can drift from it, so this asks SQLite
 * rather than parsing SQL with a regex: the schema is applied to an in-memory
 * database and the columns read back off `pragma_table_info`, which is the
 * same "ask the database, do not remember" rule the file itself preaches.
 */
test('the tables and views in reference/query.md match the SQLite schema', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(SCHEMA_SQL)
    const actual = new Map<string, string[]>()
    for (const row of db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
      .all() as { name: string }[]) {
      const columns = (db.prepare('SELECT name FROM pragma_table_info(?)').all(row.name) as { name: string }[]).map(
        (column) => column.name,
      )
      actual.set(row.name, columns)
    }
    assert.ok(actual.size >= 12, `read only ${actual.size} tables and views out of the schema`)

    // Every row of either table in the file is `| \`name\` | ... | <columns> |`;
    // the column list is the last cell in both shapes.
    const doc = readFileSync(join(SKILL, 'reference', 'query.md'), 'utf8')
    const documented = new Map<string, string[]>()
    for (const line of doc.split('\n')) {
      const match = /^\| `(\w+)` \|(.*)\|\s*$/.exec(line)
      if (match === null) continue
      const cells = match[2]!.split('|')
      const columns = [...cells.at(-1)!.matchAll(/`(\w+)`/g)].map((cell) => cell[1]!)
      if (columns.length > 0) documented.set(match[1]!, columns)
    }

    assert.deepEqual(
      [...documented.keys()].sort(),
      [...actual.keys()].sort(),
      'reference/query.md documents a different set of tables and views than src/db/schema.ts creates',
    )
    for (const [name, columns] of documented) {
      assert.deepEqual(
        columns,
        actual.get(name),
        `reference/query.md lists the wrong columns for "${name}" — the schema is the authority`,
      )
    }
  } finally {
    db.close()
  }
})

/**
 * Every view the prompt offers has to exist, by the same argument: a view named
 * where the agent will copy it and absent from the schema is an exit 2 in a
 * chat, which is how `v_sessions` was found.
 *
 * Scoped to where a name is *offered* — inside a fenced block, or as the
 * leading cell of a table row — rather than everywhere it appears. Prose is
 * allowed to name a view that does not exist, because naming the actual
 * mistake is how `query.md` warns against repeating it, and a check that
 * forbade that would forbid the warning.
 */
test('every view the prompt offers is a real view', () => {
  const views = new Set([...SCHEMA_SQL.matchAll(/CREATE VIEW (\w+)/g)].map((match) => match[1]!))
  assert.ok(views.size >= 4, `parsed only ${views.size} views out of the schema`)

  let checked = 0
  for (const { name: file, text } of promptFiles()) {
    let fenced = false
    for (const raw of text.split('\n')) {
      if (raw.trimStart().startsWith('```')) {
        fenced = !fenced
        continue
      }
      const offered = fenced ? raw : (/^\| `?(v_\w+)`? \|/.exec(raw)?.[0] ?? '')
      for (const [, used] of offered.matchAll(/\b(v_\w+)/g)) {
        checked += 1
        assert.ok(views.has(used!), `${file} offers "${used}", which is not a view in src/db/schema.ts`)
      }
    }
  }
  assert.ok(checked >= 4, `found only ${checked} view usages to check — the format changed`)
})

/**
 * Buttons only exist inside a `message` send, so that send has to carry the
 * question text too. The card used to show the `presentation` object alone, as
 * a fragment, and the model duly invented a wrapper around it: a correct pair
 * of buttons under the literal word "placeholder", with the real question
 * written as narration that went nowhere.
 *
 * A fragment teaches a fragment. The example has to be a whole call, and the
 * `message` field in it has to be a real sentence — which is the one part of
 * this a test can hold.
 */
test('the button example is a whole message call, not a bare presentation', () => {
  const card = readFileSync(join(WORKSPACE, 'AGENTS.md'), 'utf8')

  const blocks = [...card.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]!)
  const buttonExample = blocks.find((block) => block.includes('"buttons"'))
  assert.ok(buttonExample, 'AGENTS.md no longer shows a button example at all')

  assert.match(buttonExample, /"action"\s*:\s*"send"/, 'the button example omits the tool call around it')
  const text = /"message"\s*:\s*"([^"]*)"/.exec(buttonExample)?.[1]
  assert.ok(text, 'the button example carries no "message" field — which is where the question goes')
  assert.doesNotMatch(
    text,
    /^(placeholder|text|message|\.|\s*)$/i,
    `the button example's "message" is filler ("${text}") — it has to model a real question`,
  )
  assert.ok(text.length > 20, `the button example's "message" is too short to read as a question: "${text}"`)

  // The edit that strips an answered button is the same class of payload and
  // was wrong three ways at once: it named `to` (not a field), put `buttons` at
  // the top level (dropped silently), and omitted `message` (refused with
  // "content required"). Four consecutive failures on one live message.
  const editExample = blocks.find((block) => /"action"\s*:\s*"edit"/.test(block))
  assert.ok(editExample, 'AGENTS.md no longer shows how to strip an answered button')
  for (const field of ['target', 'messageId', 'message', 'presentation']) {
    assert.match(
      editExample,
      new RegExp(`"${field}"\\s*:`),
      `the edit example omits "${field}", which the message tool requires`,
    )
  }
  assert.doesNotMatch(editExample, /"to"\s*:/, 'the edit example names "to"; the argument is "target"')
  assert.doesNotMatch(
    editExample,
    /^[^]*?"buttons"\s*:\s*\[[^]*?"presentation"/,
    'the edit example puts "buttons" outside "presentation", where it is dropped silently',
  )
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
  const media = readFileSync(join(SKILL, 'reference', 'media.md'), 'utf8')
  const rows = tokenRows(media, '\n## Reactions\n')
  assert.deepEqual(
    rows.map((row) => row.token),
    REACTION_TOKENS,
    'the token table in reference/media.md drifted from the closed list in docs/spec/05-agent.md',
  )
})

test('the shipped mapping table covers every token, and ships no sticker', () => {
  const workspace = join(import.meta.dirname, '..', 'agent', 'workspace', 'REACTIONS.md')
  const rows = tokenRows(readFileSync(workspace, 'utf8'), '\n## The table\n')

  assert.deepEqual(
    rows.map((row) => row.token),
    REACTION_TOKENS,
    'REACTIONS.md and reference/media.md disagree about which tokens exist',
  )

  // No artwork ships here: the sticker set is per installation, and a file_id
  // committed to this repository would be one bot's, forever wrong elsewhere.
  // The emoji column is not an asset and may ship with a default.
  for (const { token, cells } of rows) {
    assert.equal(cells[0], '', `REACTIONS.md ships a sticker file_id for "${token}"`)
  }
})
