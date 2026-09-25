/**
 * Shipped templates and the holes they carry (`src/targets/templates.ts`).
 *
 * A seed is written once and never repaired, so the two failure modes worth a
 * test are the ones that would reach a vault permanently: a hole nobody can
 * fill, and a translation that is valid prose but invalid YAML in the position
 * it lands in.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

import { GameregError } from '../src/core/errors.ts'
import { availableLocales, translator, type Translator } from '../src/i18n/index.ts'
import { template } from '../src/targets/templates.ts'

const TEMPLATES = join(import.meta.dirname, '..', 'templates')
const names = (): string[] => readdirSync(TEMPLATES)

/** The English bundle with one key answered differently. */
function overriding(key: string, value: string): Translator {
  const base = translator('en')
  return { ...base, t: (asked, params) => (asked === key ? value : base.t(asked, params)) }
}

test('every hole in every template is filled, in every locale', () => {
  for (const locale of availableLocales()) {
    const bundle = translator(locale)
    for (const name of names()) {
      const filled = template(name, bundle)
      assert.equal(filled.includes('{{'), false, `${name} under ${locale} still carries a hole`)
    }
  }
})

test('every hole names a key English actually has', () => {
  // The runtime throw is a backstop; this is the guard that fails in CI before
  // a template reaches anyone. A typo here would otherwise only surface on the
  // build that seeds somebody's vault.
  const en = translator('en')
  for (const name of names()) {
    const source = readFileSync(join(TEMPLATES, name), 'utf8')
    for (const [, key] of source.matchAll(/\{\{([a-z0-9_.]+)\}\}/g)) {
      assert.equal(en.has(key ?? ''), true, `${name} asks for ${key}, which en.json does not define`)
    }
  }
})

test('a hole nobody can fill is a hard error, not a hole in the vault', () => {
  const blind: Translator = { ...translator('en'), has: () => false }
  assert.throws(
    () => template('Game Database.base', blind),
    (error: unknown) =>
      error instanceof GameregError && error.key === 'error.template_placeholder',
  )
})

test('a filled hole is a YAML scalar, so prose cannot corrupt the file', () => {
  // `Concluído: sim` is a plausible translation and a syntax error where it
  // lands. Pasted raw it would silently split one key into two.
  const nasty = 'Concluído: sim'
  const filled = template('Game Database.base', overriding('base.view.finished', nasty))
  const parsed = parse(filled) as { views: { name: string }[] }
  assert.equal(parsed.views[0]?.name, nasty)
})

test('a plain translation stays plain, so English output does not move', () => {
  // The serializer only quotes when it must. If this ever fails, the committed
  // seed fixtures move for a reason that has nothing to do with the register.
  const filled = template('Game Database.base', translator('en'))
  assert.match(filled, /^ {4}name: Finished$/m)
  assert.match(filled, /^ {4}displayName: Game$/m)
})

test('what the templates query is never substituted', () => {
  // Only labels carry holes. A filter is schema, and localizing one would
  // empty the view it belongs to (ADR 0111).
  for (const locale of availableLocales()) {
    const filled = template('Game Database.base', translator(locale))
    assert.match(filled, /file\.inFolder\("runs"\)/)
    assert.match(filled, /file\.hasTag\("gamereg"\)/)
    for (const status of ['finished', 'playing', 'abandoned']) {
      assert.match(filled, new RegExp(`status [!=]= "${status}"`), `${locale} lost status ${status}`)
    }
    assert.match(filled, /^ {4}image: cover$/m)
  }
})
