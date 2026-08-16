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

test('the skill declares the binary it cannot run without', () => {
  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  const frontmatter = skill.split('---')[1] ?? ''
  assert.match(frontmatter, /^name: gamereg$/m)
  assert.match(frontmatter, /^description: /m)
  assert.match(frontmatter, /"bins": \["gamereg"\]/)
})
