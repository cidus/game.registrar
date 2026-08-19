/**
 * `gamereg vocab` and the block behind it.
 *
 * This is the one piece of a locale bundle an agent is ever given, and the
 * argument for that being safe is structural rather than hopeful: a word
 * cannot be filled in the way `"Filed: {title} at {time}."` can. These tests
 * are what keep the structure true — that the block holds words and not
 * sentences, that it covers every token the CLI can put in a JSON result, and
 * that the command does not quietly start serving the rest of the bundle.
 *
 * See docs/spec/05-agent.md "Language" for why the agent needs it at all.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { availableLocales, vocabulary } from '../src/i18n/index.ts'
import { COMPLETION_CRITERIA, DIFFICULTY, FORM, GAME_STATUS, MODE, OUTCOME } from '../src/core/vocab.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')
const I18N = join(import.meta.dirname, '..', 'i18n')

function run(...args: string[]): Record<string, unknown> {
  const result = spawnSync(process.execPath, [MAIN, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1', NO_COLOR: '1' },
  })
  return JSON.parse((result.stdout ?? '').trim()) as Record<string, unknown>
}

test('the vocabulary holds words, never sentence templates', () => {
  for (const locale of availableLocales()) {
    for (const [group, terms] of Object.entries(vocabulary(locale))) {
      for (const [token, term] of Object.entries(terms)) {
        // A placeholder is the whole risk: give a model `{title}` and it can
        // fill it in, producing something indistinguishable from real output.
        assert.equal(/[{}]/.test(term), false, `${locale} ${group}.${token} carries a placeholder: ${term}`)
        assert.equal(term.trim(), term, `${locale} ${group}.${token} is padded`)
        assert.notEqual(term, '', `${locale} ${group}.${token} is empty`)
      }
    }
  }
})

test('every locale defines the same vocabulary, so no locale is a subset', () => {
  const flatten = (locale: string): string[] =>
    Object.entries(vocabulary(locale))
      .flatMap(([group, terms]) => Object.keys(terms).map((token) => `${group}.${token}`))
      .sort()

  const english = flatten('en')
  assert.ok(english.length > 25, `only ${english.length} terms — the block shrank`)
  for (const locale of availableLocales()) {
    assert.deepEqual(flatten(locale), english, `${locale} does not cover the same terms as en`)
  }
})

test('every enum token the CLI can report has a word for it', () => {
  const groups: Record<string, readonly string[]> = {
    outcome: OUTCOME,
    status: GAME_STATUS,
    completion_criteria: COMPLETION_CRITERIA,
    difficulty: DIFFICULTY,
    form: FORM,
    mode: MODE,
  }

  for (const locale of availableLocales()) {
    const found = vocabulary(locale)
    for (const [group, tokens] of Object.entries(groups)) {
      for (const token of tokens) {
        assert.ok(found[group]?.[token], `${locale} has no term for ${group}.${token}`)
      }
    }
  }
})

test("the register's own acts are named, which is what the agent cannot infer", () => {
  for (const locale of availableLocales()) {
    const register = vocabulary(locale)['register'] ?? {}
    for (const act of ['filed', 'approved', 'archived', 'pending', 'certified_copy']) {
      assert.ok(register[act], `${locale} does not name ${act}`)
    }
  }
})

/**
 * The nouns leaked English into Portuguese chat before they were here — "uma
 * run em aberto" — for the same reason the acts did: the words existed only
 * inside sentence templates, where nothing can look them up.
 */
test('the things the register holds are named too, not only what happens to them', () => {
  for (const locale of availableLocales()) {
    const entity = vocabulary(locale)['entity'] ?? {}
    for (const thing of ['game', 'run', 'session', 'break', 'verdict']) {
      assert.ok(entity[thing], `${locale} does not name a ${thing}`)
    }
  }

  // A distinction the agent got wrong live: these are two different things and
  // a locale that renders them with one word cannot express the difference.
  for (const locale of availableLocales()) {
    const entity = vocabulary(locale)['entity'] ?? {}
    assert.notEqual(entity['run'], entity['session'], `${locale} calls a run and a session the same thing`)
  }
})

test('the command reports the vocabulary and no other part of the bundle', () => {
  const payload = run('vocab', '--locale', 'pt-BR')
  assert.equal(payload['ok'], true)
  assert.equal(payload['action'], 'vocab')

  const result = payload['result'] as { locale: string; vocabulary: Record<string, Record<string, string>> }
  assert.equal(result.locale, 'pt-BR')
  assert.equal(result.vocabulary['register']?.['filed'], 'protocolada')
  assert.equal(result.vocabulary['completion_criteria']?.['true_ending'], 'final verdadeiro')

  // The bundle's other blocks are what carry templates and key names. None of
  // them may travel: the agent is handed words, and only words.
  const serialized = JSON.stringify(payload)
  assert.equal(/[{]\w+[}]/.test(serialized.replace(/[{]"/g, '')), false, 'a placeholder reached the output')
  const bundle = JSON.parse(readFileSync(join(I18N, 'pt-BR.json'), 'utf8')) as Record<string, unknown>
  for (const block of ['prose', 'error', 'help', 'prompt', 'note', 'table', 'cli']) {
    const sample = JSON.stringify(bundle[block]).slice(2, 40)
    assert.equal(serialized.includes(sample), false, `the ${block} block leaked into vocab output`)
  }
})

test('the vocabulary command never writes an event', () => {
  const payload = run('vocab', '--locale', 'en')
  assert.deepEqual(payload['events'], [])
})
