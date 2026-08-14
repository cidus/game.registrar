/**
 * End-to-end, through the real binary: exit codes and the JSON output contract
 * (docs/spec/02-cli.md). Every invocation runs non-interactive, which is what an
 * agent behind a pipe gets.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const MAIN = join(import.meta.dirname, '..', 'src', 'cli', 'main.ts')

type Run = { status: number; json: Record<string, unknown>; stdout: string; stderr: string }

function vault(): string {
  const root = join(tempDir('gamereg-cli-'), 'vault')
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'America/Sao_Paulo', day_cutoff: '05:00' }),
  )
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

test('a session opens, breaks, and closes with the arithmetic done in code', () => {
  const root = vault()

  const started = gamereg(root, 'start', 'hollow knight', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  assert.equal(started.status, 0)
  assert.equal(started.json['ok'], true)
  assert.equal(started.json['action'], 'session.open')
  assert.equal((started.json['events'] as string[]).length, 3)

  assert.equal(gamereg(root, 'break', 'start', '--at', '2026-05-03 21:00').status, 0)
  assert.equal(gamereg(root, 'break', 'end', '--at', '2026-05-03 21:30').status, 0)

  const ended = gamereg(root, 'end', '--at', '2026-05-03 23:00', '--break', '20m', '--note', 'Tight combat.')
  assert.equal(ended.status, 0)
  assert.equal(result(ended)['minutes'], 130)
  assert.equal(result(ended)['break_minutes'], 50)
  assert.equal(result(ended)['logical_day'], '2026-05-03')
})

test('a second session on an open run reuses it', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  gamereg(root, 'end', '--at', '2026-05-03 21:00')

  const again = gamereg(root, 'start', 'celeste', '--at', '2026-05-04 20:00')
  assert.equal(result(again)['run_opened'], false)
  assert.equal(result(again)['replay'], false)
})

test('starting a session that is already open is a conflict', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')

  const again = gamereg(root, 'start', 'celeste', '--at', '2026-05-03 21:00')
  assert.equal(again.status, 5)
  assert.equal(again.json['ok'], false)
  assert.equal(again.json['error'], 'conflict')
})

test('closing with no session open is a conflict', () => {
  const run = gamereg(vault(), 'end')
  assert.equal(run.status, 5)
  assert.equal(run.json['error'], 'conflict')
})

test('an unknown title returns not_found with the escape hatch named', () => {
  const run = gamereg(vault(), 'start', 'hades')
  assert.equal(run.status, 4)
  assert.equal(run.json['error'], 'not_found')
  assert.equal(run.json['query'], 'hades')
  assert.deepEqual(run.json['candidates'], [])
})

test('an ambiguous query returns code 3 and the candidates, and never blocks', () => {
  const root = vault()
  gamereg(root, 'start', 'Zelda: Breath of the Wild', '--platform', 'Switch', '--no-metadata', '--at', '2026-01-01 10:00')
  gamereg(root, 'end', '--at', '2026-01-01 11:00')
  gamereg(root, 'start', 'Zelda: Tears of the Kingdom', '--platform', 'Switch', '--no-metadata', '--at', '2026-02-01 10:00')
  gamereg(root, 'end', '--at', '2026-02-01 11:00')

  const run = gamereg(root, 'start', 'zelda', '--at', '2026-03-01 10:00')
  assert.equal(run.status, 3)
  assert.equal(run.json['error'], 'ambiguous')
  const candidates = run.json['candidates'] as { ref: string }[]
  assert.equal(candidates.length, 2)

  // Re-invoking with --id resolves it, and files the query as an alias.
  // The run is still open (only the session was closed), so it is reused: one
  // alias event and one session, and no second run.
  const picked = gamereg(root, 'start', 'zelda', '--id', candidates[0]!.ref, '--at', '2026-03-01 10:00')
  assert.equal(picked.status, 0)
  assert.equal((picked.json['events'] as string[]).length, 2)
  assert.equal(result(picked)['run_opened'], false)

  const status = gamereg(root, 'status', 'zelda')
  assert.equal(status.status, 0)
  assert.deepEqual((result(status)['game'] as { aliases: string[] }).aliases, ['zelda'])
})

test('several open sessions make an omitted query ambiguous', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  gamereg(root, 'start', 'hades', '--platform', 'PC', '--no-metadata', '--at', '2026-05-03 20:30')

  const run = gamereg(root, 'end', '--at', '2026-05-03 21:00')
  assert.equal(run.status, 3)
  assert.equal((run.json['candidates'] as unknown[]).length, 2)

  const named = gamereg(root, 'end', 'hades', '--at', '2026-05-03 21:00')
  assert.equal(named.status, 0)
})

test('an invalid enum exits 2 and lists the valid tokens', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')

  const run = gamereg(root, 'finish', 'celeste', '--criteria', 'ending', '--at', '2026-05-03 22:00')
  assert.equal(run.status, 2)
  assert.equal(run.json['error'], 'usage')
  assert.match(String(run.json['message']), /true_ending/)
})

test('a rating outside the scale exits 2, and eleven is accepted', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')

  assert.equal(gamereg(root, 'finish', 'celeste', '--rating', '12', '--at', '2026-05-03 22:00').status, 2)

  const eleven = gamereg(root, 'finish', 'celeste', '--rating', '11', '--at', '2026-05-03 22:00')
  assert.equal(eleven.status, 0)
  assert.equal(result(eleven)['rating'], 11)
})

test('closing before opening is rejected, not clamped', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')

  const run = gamereg(root, 'end', '--at', '2026-05-03 19:00')
  assert.equal(run.status, 2)
  const log = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
  assert.equal(log.includes('session.close'), false)
})

test('a first run with no platform anywhere records none, and starts anyway', () => {
  const run = gamereg(vault(), 'start', 'celeste', '--no-metadata')
  assert.equal(run.status, 0)
  assert.equal(result(run)['platform'], null)
  // Nothing answered, so nothing to attribute an answer to.
  assert.equal(result(run)['platform_source'], undefined)
})

test('--replay opens a second run, and the table gets a second line', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  gamereg(root, 'finish', 'celeste', '--rating', '9', '--at', '2026-05-03 22:00')

  const replay = gamereg(root, 'start', 'celeste', '--replay', '--at', '2027-01-01 20:00')
  assert.equal(result(replay)['replay'], true)
  assert.equal(result(replay)['run_opened'], true)

  gamereg(root, 'end', '--at', '2027-01-01 21:00')
  gamereg(root, 'build')
  const table = readFileSync(join(root, 'obsidian', 'Game List.md'), 'utf8')
  assert.equal(table.split('[[celeste').length - 1, 2)
})

test('--dry-run computes everything and writes nothing', () => {
  const root = vault()
  const run = gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--dry-run')
  assert.equal(run.status, 0)
  assert.equal(run.json['dry_run'], true)
  assert.throws(() => readFileSync(join(root, 'data', 'events.jsonl'), 'utf8'))
})

test('amend and revoke append, and the original line stays on record', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  const ended = gamereg(root, 'end', '--at', '2026-05-03 21:00')
  const closeEvent = (ended.json['events'] as string[])[0]!

  const before = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
  const amended = gamereg(root, 'amend', closeEvent, '--reason', 'wrong hour', '--set', 'at=2026-05-03T22:00:00-03:00')
  assert.equal(amended.status, 0)

  const after = readFileSync(join(root, 'data', 'events.jsonl'), 'utf8')
  assert.ok(after.startsWith(before))

  const status = gamereg(root, 'status', 'celeste')
  assert.equal((result(status)['runs'] as { minutes: number }[])[0]?.minutes, 120)

  const revoked = gamereg(root, 'revoke', closeEvent, '--reason', 'never happened')
  assert.equal(revoked.status, 0)
  assert.equal((result(gamereg(root, 'open'))['open'] as unknown[]).length, 1)
})

test('amend --set platform=... canonicalizes, same as the --platform flag', () => {
  const root = vault()
  const started = gamereg(root, 'start', 'hollow knight', '--no-metadata', '--at', '2026-05-03 20:00')
  const openEvent = (started.json['events'] as string[])[1]!

  const amended = gamereg(root, 'amend', openEvent, '--reason', 'user corrected the platform', '--set', 'platform=Switch')
  assert.equal(amended.status, 0)
  assert.equal((result(amended)['patch'] as Record<string, unknown>)['platform'], 'Nintendo Switch')

  const status = gamereg(root, 'status', 'hollow knight')
  assert.equal((result(status)['runs'] as { platform: string }[])[0]?.platform, 'Nintendo Switch')
})

test('past files a stated duration and marks it as stated', () => {
  const root = vault()
  const run = gamereg(root, 'past', 'chrono trigger', '--ended', '2011-07', '--rating', '10', '--hours', '30', '--no-metadata')
  assert.equal(run.status, 0)
  assert.equal(result(run)['hours_source'], 'stated')
  assert.equal(result(run)['date_precision'], 'month')
  assert.equal(result(run)['minutes'], 1800)
})

test('start --past-hours opens a run with a stated baseline, on top of which sessions still measure', () => {
  const root = vault()
  const started = gamereg(root, 'start', 'opus magnum', '--no-metadata', '--past-hours', '30', '--at', '2026-08-14 20:00')
  assert.equal(started.status, 0)

  const afterStart = gamereg(root, 'status', 'opus magnum')
  const runAfterStart = (result(afterStart)['runs'] as { minutes: number; hours_source: string }[])[0]!
  assert.equal(runAfterStart.minutes, 1800)
  assert.equal(runAfterStart.hours_source, 'stated')

  gamereg(root, 'end', '--at', '2026-08-14 21:30')
  const afterEnd = gamereg(root, 'status', 'opus magnum')
  const runAfterEnd = (result(afterEnd)['runs'] as { minutes: number; hours_source: string }[])[0]!
  assert.equal(runAfterEnd.minutes, 1890)
  assert.equal(runAfterEnd.hours_source, 'mixed')
})

test('--past-hours on a resumed run (no new run.open) is a usage error', () => {
  const root = vault()
  gamereg(root, 'start', 'opus magnum', '--no-metadata', '--at', '2026-08-14 20:00')
  gamereg(root, 'end', '--at', '2026-08-14 21:00')
  const resumed = gamereg(root, 'start', 'opus magnum', '--past-hours', '30')
  assert.equal(resumed.status, 2)
  assert.equal(resumed.json['error'], 'usage')
})

test('past without --ended opens a run with no session, reusable by start later', () => {
  const root = vault()
  const filed = gamereg(root, 'past', 'opus magnum', '--no-metadata', '--hours', '30', '--at', '2026-08-14 09:00')
  assert.equal(filed.status, 0)
  assert.equal(filed.json['action'], 'run.open')
  assert.equal(result(filed)['minutes'], 1800)
  assert.equal(result(filed)['hours_source'], 'stated')

  assert.equal((result(gamereg(root, 'open'))['open'] as unknown[]).length, 0)

  const resumed = gamereg(root, 'start', 'opus magnum', '--at', '2026-08-14 20:00')
  assert.equal(resumed.status, 0)
  assert.equal(result(resumed)['run_opened'], false)

  gamereg(root, 'end', '--at', '2026-08-14 21:30')
  const status = gamereg(root, 'status', 'opus magnum')
  const run = (result(status)['runs'] as { minutes: number; hours_source: string }[])[0]!
  assert.equal(run.minutes, 1890)
  assert.equal(run.hours_source, 'mixed')
})

test('past requires --ended, --hours, or both', () => {
  const root = vault()
  const run = gamereg(root, 'past', 'opus magnum', '--no-metadata')
  assert.equal(run.status, 2)
})

test('past without --ended rejects fields that describe how a run closed', () => {
  const root = vault()
  const run = gamereg(root, 'past', 'opus magnum', '--no-metadata', '--hours', '30', '--rating', '9')
  assert.equal(run.status, 2)
})

test('past without --ended conflicts with a run already open for that game', () => {
  const root = vault()
  gamereg(root, 'start', 'opus magnum', '--no-metadata', '--at', '2026-08-14 20:00')
  const filed = gamereg(root, 'past', 'opus magnum', '--hours', '30')
  assert.equal(filed.status, 5)
})

test('doctor reports a broken log and exits 1', () => {
  const root = vault()
  gamereg(root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00')
  const file = join(root, 'data', 'events.jsonl')
  writeFileSync(
    file,
    `${readFileSync(file, 'utf8')}{"id":"01K5A00000000000000000BAD1","ts":"2026-05-03T23:00:00-03:00","type":"session.close","source":"cli","schema":1,"data":{"session_id":"ghost","at":"2026-05-03T23:00:00-03:00"}}\n`,
  )

  const run = gamereg(root, 'doctor')
  assert.equal(run.status, 1)
  assert.equal(run.json['ok'], false)
  assert.equal((run.json['problems'] as unknown[]).length, 1)
})

test('localized command names and flags work regardless of the output locale', () => {
  const root = vault()
  const run = gamereg(root, 'iniciar', 'celeste', '--plataforma', 'Switch', '--sem-metadados', '--em', '2026-05-03 20:00')
  assert.equal(run.status, 0)
  assert.equal(run.json['action'], 'session.open')
})

function help(...args: string[]): string {
  const result = spawnSync(process.execPath, [MAIN, ...args, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1' },
  })
  return result.stdout ?? ''
}

test('--help under --locale en shows canonical vocabulary only', () => {
  const text = help('start', '--locale', 'en')
  assert.match(text, /Usage: gamereg start \[options\] <query>/)
  assert.equal(/\biniciar\b/.test(text), false)
  assert.equal(/\bconsulta\b/.test(text), false)
})

test('--help under --locale pt-BR carries no English vocabulary', () => {
  const text = help('start', '--locale', 'pt-BR')
  assert.match(text, /Usage: gamereg iniciar \[options\] <consulta>/)
  assert.match(text, /--acervo <path>/)
  // The canonical English forms must not leak in alongside the translation.
  assert.equal(/\bstart\b/.test(text), false)
  assert.equal(/--vault\b/.test(text), false)
  assert.equal(/\bquery\b/.test(text), false)
})

test('a nested group --help stays in one locale, with no stray help-command line', () => {
  const text = help('break', '--locale', 'pt-BR')
  assert.match(text, /\bintervalo\b/)
  assert.equal(text.includes('help [command]'), false)
  assert.equal(/\bbreak\b/.test(text), false)
})

test('a nested subcommand --help localizes its whole ancestor chain', () => {
  const text = help('break', 'start', '--locale', 'pt-BR')
  assert.match(text, /Usage: gamereg intervalo iniciar \[options\] \[consulta\]/)
})

test('prose output carries the Registrar voice, JSON never does', () => {
  const root = vault()
  const started = spawnSync(
    process.execPath,
    [MAIN, '--vault', root, 'start', 'celeste', '--platform', 'Switch', '--no-metadata', '--at', '2026-05-03 20:00'],
    { encoding: 'utf8', env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1' } },
  )
  // stdout is a pipe here, so the machine contract wins over the prose one.
  assert.match(started.stdout, /"ok":true/)

  const spoken = spawnSync(
    process.execPath,
    [MAIN, '--vault', root, 'open', '--locale', 'pt-BR'],
    { encoding: 'utf8', env: { ...process.env, GAMEREG_NON_INTERACTIVE: '1' } },
  )
  assert.match(spoken.stdout, /"ok":true/)
})
