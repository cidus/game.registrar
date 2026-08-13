/**
 * The `html` target (docs/spec/07-targets.md). Exercised directly, same
 * reason as sqlite.test.ts and json-target.test.ts.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { readEvents } from '../src/core/events.ts'
import { fold, type VaultState } from '../src/core/fold.ts'
import { openVault, timeContext } from '../src/core/vault.ts'
import { translator } from '../src/i18n/index.ts'
import { html } from '../src/targets/html.ts'

const EXAMPLE = join(import.meta.dirname, '..', 'example-vault')

function exampleState(): VaultState {
  const vault = openVault(EXAMPLE)
  return fold(readEvents(vault.eventsFile), timeContext(vault))
}

function plan(locale = 'en'): string {
  const vault = openVault(EXAMPLE)
  const planned = html.plan(exampleState(), { config: vault.config, bundle: translator(locale) })
  assert.equal(planned.length, 1)
  assert.equal(planned[0]!.path, 'Games.html')
  assert.equal(planned[0]!.policy, 'replace')
  return planned[0]!.content as string
}

test('is one self-contained file: no external script, style or font references', () => {
  const document = plan()
  assert.doesNotMatch(document, /<link[^>]+href=/)
  assert.doesNotMatch(document, /\bsrc=["']https?:/)
  assert.doesNotMatch(document, /cdn\./)
})

test('embeds the run data as JSON, in schema tokens, not translated labels', () => {
  const document = plan('pt-BR')
  const match = document.match(/window\.__GAMEREG_RUNS__ = (\[.*?\]);/s)
  assert.ok(match)
  const rows = JSON.parse(match![1]!) as Record<string, unknown>[]
  assert.ok(rows.length > 0)
  assert.ok('completion_criteria' in rows[0]!)
  assert.ok(typeof rows[0]!['hours'] === 'string')
})

test('table headers follow the locale', () => {
  const en = plan('en')
  const pt = plan('pt-BR')
  assert.match(en, />Hours</)
  assert.notEqual(en, pt)
})

test('two builds from the same state are byte-identical', () => {
  assert.equal(plan(), plan())
})

test('the embedded JSON has every "<" escaped, so a title cannot close the script tag early', () => {
  const document = plan()
  const start = document.indexOf('window.__GAMEREG_RUNS__ = ') + 'window.__GAMEREG_RUNS__ = '.length
  const end = document.indexOf(';</script>', start)
  const embedded = document.slice(start, end)
  assert.doesNotMatch(embedded, /</)
})
