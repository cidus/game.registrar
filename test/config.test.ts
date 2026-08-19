/**
 * `gamereg.config.json` (docs/spec/02-cli.md).
 *
 * The interesting half is what the loader *refuses*. An unknown key used to be
 * ignored in silence, which is how `07-targets.md` shipped an example with
 * `build.obsidian.run_notes` for four phases: nothing parsed it, nothing said
 * so, and a vault that copied the example got no error and no effect. These
 * tests are the reason that cannot happen again — including for the keys this
 * file does not know about yet, since the valid names come from
 * `DEFAULT_CONFIG` rather than from a list kept here.
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { GameregError } from '../src/core/errors.ts'
import { CONFIG_FILENAME, DEFAULT_CONFIG, loadConfig, writeConfig } from '../src/core/config.ts'
import { tempDir } from './helpers.ts'

function vaultWith(config: unknown): string {
  const root = tempDir('gamereg-config-')
  writeFileSync(join(root, CONFIG_FILENAME), JSON.stringify(config, null, 2))
  return root
}

/** The thrown error, so a test can assert on the key and the params. */
function refusal(config: unknown): GameregError {
  const root = vaultWith(config)
  try {
    loadConfig(root)
  } catch (error) {
    assert.ok(error instanceof GameregError)
    return error
  }
  throw new assert.AssertionError({ message: 'the config was accepted' })
}

test('an unknown key is a usage error naming the key and what is valid', () => {
  const error = refusal({ locale: 'en', colour: 'blue' })

  assert.equal(error.error, 'usage')
  assert.equal(error.code, 2)
  assert.equal(error.key, 'error.unknown_config_key')
  assert.equal(error.params['key'], 'colour')
  // Listing the alternatives is the difference between a refusal and a riddle.
  assert.match(String(error.params['valid']), /locale/)
})

test('a nested unknown key is reported by its path, not by its last segment', () => {
  // The exact shape 07-targets.md advertised and core/config.ts never read.
  const error = refusal({ build: { targets: ['obsidian'], obsidian: { run_notes: true } } })
  assert.equal(error.params['key'], 'build.obsidian')
  assert.equal(error.params['valid'], 'targets, csv')
})

test('every level is checked, not only the top one', () => {
  assert.equal(refusal({ defaults: { platform: 'PS5', genre: 'rpg' } }).params['key'], 'defaults.genre')
  assert.equal(refusal({ build: { csv: { dir: 'data', sep: ';' } } }).params['key'], 'build.csv.sep')
  assert.equal(refusal({ images: { max_edge: 2000, format: 'avif' } }).params['key'], 'images.format')
})

test('a platform entry takes name and aliases, and says so when given more', () => {
  const error = refusal({ platforms: [{ name: 'Mega Drive', alias: ['Genesis'] }] })
  assert.equal(error.params['key'], 'platforms[].alias')
  assert.equal(error.params['valid'], 'name, aliases')
})

test('an array is not walked as if it were a shape', () => {
  // `build.targets` and `platforms` hold values, not settings; their own
  // parsers validate them, and the key walker must keep its hands off.
  const root = vaultWith({ build: { targets: ['obsidian', 'csv'] }, platforms: ['PS5', { name: 'PC', aliases: [] }] })
  const config = loadConfig(root)
  assert.deepEqual(config.build.targets, ['obsidian', 'csv'])
  assert.deepEqual(config.platforms.map((entry) => entry.name), ['PS5', 'PC'])
})

test('a config using every documented key loads clean', () => {
  // What would have caught the spec example: the whole surface, exercised.
  const root = vaultWith({
    locale: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    day_cutoff: '05:00',
    defaults: { platform: 'Switch', form: 'digital', mode: 'solo' },
    platforms: ['PS5', { name: 'Mega Drive', aliases: ['Genesis'] }],
    build: { targets: ['obsidian', 'csv'], csv: { dir: 'data' } },
    images: { max_edge: 2000, quality: 82, keep_original: false, publish: false },
  })

  const config = loadConfig(root)
  assert.equal(config.locale, 'pt-BR')
  assert.equal(config.defaults.form, 'digital')
  assert.equal(config.build.csv.dir, 'data')
  assert.equal(config.images.quality, 82)
})

test('what the writer writes, the stricter reader still accepts', () => {
  // configToJson spreads the whole Config, so writer and reader have to agree
  // on the key set exactly. `init` and `platform add` both go through it, and
  // a vault that cannot re-read its own config is the worst version of this.
  const root = tempDir('gamereg-config-roundtrip-')
  writeConfig(root, { ...DEFAULT_CONFIG, platforms: [{ name: 'Mega Drive', aliases: ['Genesis'] }] })

  const reloaded = loadConfig(root)
  assert.deepEqual(reloaded.platforms, [{ name: 'Mega Drive', aliases: ['Genesis'] }])

  // And again, from what was just read: a fixed point, not a one-way trip.
  writeConfig(root, reloaded)
  assert.deepEqual(loadConfig(root), reloaded)
})

test('a vault with no config at all is still a vault', () => {
  assert.deepEqual(loadConfig(tempDir('gamereg-config-none-')), DEFAULT_CONFIG)
})
