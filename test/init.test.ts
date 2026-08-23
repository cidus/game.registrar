/**
 * `gamereg init` — end-to-end, through the real binary (docs/spec/02-cli.md).
 * Every invocation runs non-interactive, which is what an agent behind a pipe
 * gets: built-in defaults, never a prompt.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

type Run = { status: number; json: Record<string, unknown>; stdout: string; stderr: string }

function emptyRoot(): string {
  const root = join(tempDir('gamereg-init-'), 'vault')
  mkdirSync(root, { recursive: true })
  return root
}

function gamereg(root: string, ...args: string[]): Run {
  const result = spawnSync(process.execPath, [MAIN, '--vault', root, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1', NO_COLOR: '1' },
  })
  const stdout = result.stdout ?? ''
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(stdout.trim()) as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: result.status ?? 1, json, stdout, stderr: result.stderr ?? '' }
}

const result = (run: Run): Record<string, unknown> => run.json['result'] as Record<string, unknown>
const config = (root: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, 'gamereg.config.json'), 'utf8')) as Record<string, unknown>

test('init with no flags writes the built-in defaults, non-interactively', () => {
  const root = emptyRoot()
  const run = gamereg(root, 'init')
  assert.equal(run.status, 0)
  assert.equal(run.json['ok'], true)

  const written = config(root)
  assert.equal(written['locale'], null)
  assert.equal(written['timezone'], null)
  assert.equal(written['day_cutoff'], '05:00')
  assert.deepEqual(written['defaults'], { platform: null, form: 'digital', mode: 'solo' })
  assert.deepEqual((written['build'] as Record<string, unknown>)['targets'], ['obsidian'])
})

test('flags override the built-ins', () => {
  const root = emptyRoot()
  const run = gamereg(
    root,
    'init',
    '--locale',
    'pt-BR',
    '--timezone',
    'America/Sao_Paulo',
    '--day-cutoff',
    '06:00',
    '--platform',
    'Switch',
    '--form',
    'physical',
    '--mode',
    'coop',
    '--targets',
    'obsidian,csv',
    '--csv-dir',
    'exports/',
  )
  assert.equal(run.status, 0)

  const written = config(root)
  assert.equal(written['locale'], 'pt-BR')
  assert.equal(written['timezone'], 'America/Sao_Paulo')
  assert.equal(written['day_cutoff'], '06:00')
  assert.deepEqual(written['defaults'], { platform: 'Switch', form: 'physical', mode: 'coop' })
  const build = written['build'] as Record<string, unknown>
  assert.deepEqual(build['targets'], ['obsidian', 'csv'])
  assert.deepEqual(build['csv'], { dir: 'exports' })
})

test('an invalid day_cutoff exits 2', () => {
  const run = gamereg(emptyRoot(), 'init', '--day-cutoff', '25:99')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('an invalid enum in --form exits 2 and lists the valid tokens', () => {
  const run = gamereg(emptyRoot(), 'init', '--form', 'boxed')
  assert.equal(run.status, 2)
  assert.match(String(run.json['message']), /digital/)
})

test('an unknown build target exits 2', () => {
  const run = gamereg(emptyRoot(), 'init', '--targets', 'obsidian,nonsense')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
})

test('a target this version cannot build is refused where it is named', () => {
  // `quartz` is inside the current phase and not written yet, which is refused
  // at the same exit code a later phase is: either way the vault would come to
  // declare a target no build could satisfy.
  const run = gamereg(emptyRoot(), 'init', '--targets', 'quartz', '--locale', 'en')
  assert.equal(run.status, 2)
  assert.match(String(run.json['message']), /not implemented/)
})

test('a target the current phase does build is accepted', () => {
  const root = emptyRoot()
  const run = gamereg(root, 'init', '--targets', 'obsidian,stats', '--locale', 'en')
  assert.equal(run.status, 0)
  assert.deepEqual(
    ((config(root)['build'] as Record<string, unknown>)['targets']),
    ['obsidian', 'stats'],
  )
})

test('re-running init on an existing vault is a conflict without --yes', () => {
  const root = emptyRoot()
  gamereg(root, 'init', '--locale', 'en')

  const again = gamereg(root, 'init', '--locale', 'pt-BR')
  assert.equal(again.status, 7)
  assert.equal(again.json['error'], 'needs_confirmation')
  assert.equal(config(root)['locale'], 'en')
})

test('--yes overwrites, seeding untouched fields from the existing config', () => {
  const root = emptyRoot()
  gamereg(root, 'init', '--locale', 'en', '--timezone', 'America/Sao_Paulo')

  const again = gamereg(root, 'init', '--yes', '--locale', 'pt-BR')
  assert.equal(again.status, 0)
  assert.equal(result(again)['overwritten'], true)

  const written = config(root)
  assert.equal(written['locale'], 'pt-BR')
  // Untouched by the second call, carried over from the first.
  assert.equal(written['timezone'], 'America/Sao_Paulo')
})

test('init never appends an event and never touches the log', () => {
  const root = emptyRoot()
  const run = gamereg(root, 'init')
  assert.deepEqual(run.json['events'], [])
  assert.equal(existsSync(join(root, 'data', 'events.jsonl')), false)
})

test('--dry-run computes the config and writes nothing', () => {
  const root = emptyRoot()
  const run = gamereg(root, 'init', '--dry-run')
  assert.equal(run.status, 0)
  assert.equal(run.json['dry_run'], true)
  assert.equal(existsSync(join(root, 'gamereg.config.json')), false)
  assert.equal(existsSync(join(root, 'gamereg.secrets.json')), false)
  assert.equal(existsSync(join(root, '.gitignore')), false)
})

test('init seeds an empty secrets file, one entry per known provider', () => {
  const root = emptyRoot()
  const run = gamereg(root, 'init')
  assert.equal(run.status, 0)

  const secretsFile = join(root, 'gamereg.secrets.json')
  assert.equal(existsSync(secretsFile), true)
  const secrets = JSON.parse(readFileSync(secretsFile, 'utf8')) as Record<string, unknown>
  assert.deepEqual(secrets, {
    igdb: { client_id: '', client_secret: '' },
  })
})

test('init appends gamereg.secrets.json to .gitignore, creating it if absent', () => {
  const root = emptyRoot()
  gamereg(root, 'init')

  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
  assert.match(gitignore, /^gamereg\.secrets\.json$/m)
})

test('init preserves an existing .gitignore and does not duplicate the entry', () => {
  const root = emptyRoot()
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n')

  gamereg(root, 'init')
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
  assert.match(gitignore, /node_modules\//)
  assert.equal(gitignore.match(/gamereg\.secrets\.json/g)?.length, 1)

  // Re-running init (--yes, to bypass the vault_exists conflict) must not duplicate it.
  gamereg(root, 'init', '--yes')
  const again = readFileSync(join(root, '.gitignore'), 'utf8')
  assert.equal(again.match(/gamereg\.secrets\.json/g)?.length, 1)
})

test('re-running init never overwrites an existing secrets file', () => {
  const root = emptyRoot()
  gamereg(root, 'init')
  const secretsFile = join(root, 'gamereg.secrets.json')
  writeFileSync(secretsFile, JSON.stringify({ igdb: { client_id: 'mine', client_secret: '' } }))

  gamereg(root, 'init', '--yes')
  const secrets = JSON.parse(readFileSync(secretsFile, 'utf8')) as Record<string, unknown>
  assert.deepEqual(secrets, { igdb: { client_id: 'mine', client_secret: '' } })
})
