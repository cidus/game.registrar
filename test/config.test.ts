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
    checkin: {
      after: '4h',
      clock: ['01:00'],
      chase_at: '09:00',
      backoff: ['2h', '3h', '5h'],
      max_per_session: 3,
      reply_window: '45m',
      quiet_hours: ['02:00', '09:00'],
      persona_prompt: 'Dry, faintly Victorian. Never scolds. One or two sentences.',
    },
    images: { max_edge: 2000, quality: 82, keep_original: false, publish: false },
  })

  const config = loadConfig(root)
  assert.equal(config.locale, 'pt-BR')
  assert.equal(config.defaults.form, 'digital')
  assert.equal(config.build.csv.dir, 'data')
  assert.equal(config.images.quality, 82)
  assert.equal(config.checkin.after, '4h')
  assert.deepEqual(config.checkin.backoff, ['2h', '3h', '5h'])
})

/**
 * The check-in block, whose values are all parsed ones — a duration, a time of
 * day, a counter. A typo in any of them would otherwise surface hours later,
 * unattended, at the moment a trigger would have fired.
 */
test('null is a setting in the check-in block, not an omission', () => {
  // Both of these change behaviour: `after: null` switches the duration
  // trigger off, and `chase_at: null` asks at the cutoff instead of in the
  // morning. Reading either as "unset" would restore the default and keep
  // asking — silently, which is the version nobody notices.
  const config = loadConfig(vaultWith({ checkin: { after: null, chase_at: null, persona_prompt: null } }))
  assert.equal(config.checkin.after, null)
  assert.equal(config.checkin.chase_at, null)
  assert.equal(config.checkin.persona_prompt, null)
})

test('a malformed check-in value is refused by its own path', () => {
  assert.equal(refusal({ checkin: { after: 'soon' } }).params['key'], 'checkin.after')
  assert.equal(refusal({ checkin: { backoff: ['2h', 'later'] } }).params['key'], 'checkin.backoff[1]')
  assert.equal(refusal({ checkin: { clock: ['25:00'] } }).params['key'], 'checkin.clock[0]')
  assert.equal(refusal({ checkin: { chase_at: '9am' } }).params['key'], 'checkin.chase_at')
  assert.equal(refusal({ checkin: { reply_window: 45 } }).params['key'], 'checkin.reply_window')
  assert.equal(refusal({ checkin: { max_per_session: -1 } }).params['key'], 'checkin.max_per_session')
  assert.equal(refusal({ checkin: { max_per_session: 2.5 } }).params['key'], 'checkin.max_per_session')
  // A window with one end is a window with no end, and there is no reading of
  // it that is not a guess.
  assert.equal(refusal({ checkin: { quiet_hours: ['02:00'] } }).params['key'], 'checkin.quiet_hours')

  const error = refusal({ checkin: { after: 'soon' } })
  assert.equal(error.code, 2)
  assert.equal(error.key, 'error.bad_config_value')
})

test('day_cutoff is checked where it is written, not where it is used', () => {
  // It used to fail inside logicalDay, mid-command, having already been read
  // as valid by everything upstream of it.
  const error = refusal({ day_cutoff: '5h' })
  assert.equal(error.key, 'error.bad_config_value')
  assert.equal(error.params['key'], 'day_cutoff')
})

test('an unknown key inside the check-in block is refused like any other', () => {
  assert.equal(refusal({ checkin: { snooze: '2h' } }).params['key'], 'checkin.snooze')
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
