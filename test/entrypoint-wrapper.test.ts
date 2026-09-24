/**
 * `docker/entrypoint.sh`, the container boot, driven end to end.
 *
 * Third sibling of `test/checkin-wrapper.test.ts` and
 * `test/autobuild-wrapper.test.ts`, and the reason for it is the same one that
 * justified those: this script is the piece that cannot be exercised by the
 * CLI's own test harness, runs unattended on a host nobody is watching, and
 * fails at the least convenient moment. A renamed flag should fail here rather
 * than on a first boot in a datacentre.
 *
 * `gamereg` is real and runs against a real vault. `openclaw` is stubbed —
 * every invocation is logged, `cron list` answers from a file a test controls,
 * and `config patch --stdin` captures what it was fed — because the real one
 * would need a gateway, a bot token and a network. `git` is real, but `HOME`
 * is a temporary directory, so `git config --global` never reaches the
 * developer's own `~/.gitconfig`.
 *
 * The image itself is not built here. Whether the Dockerfile assembles is a
 * question for a host with a Docker daemon; whether the script it installs
 * does the right thing is answerable here, and is the half that carries the
 * logic.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { parse } from 'yaml'

import { tempDir } from './helpers.ts'

const ROOT = join(import.meta.dirname, '..')
const WRAPPER = join(ROOT, 'docker', 'entrypoint.sh')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')

type Host = {
  vault: string
  config: string
  defaults: string
  /** Every stubbed `openclaw` invocation, one line of argv per call. */
  calls: () => string[]
  /** What `config patch --stdin` was fed, concatenated. */
  patched: () => string
  /** Pretend the check-in job is already in the gateway's cron store. */
  cronHolds: (name: string) => void
  run: (
    mode: string,
    env?: Record<string, string>,
    args?: string[],
  ) => { status: number; stdout: string; stderr: string }
}

/**
 * A vault directory, a config directory, a defaults tree standing in for what
 * the Dockerfile copies to `/opt/gamereg/agent-defaults`, and an `openclaw`
 * stub on PATH ahead of anything real.
 */
function host(): Host {
  const dir = tempDir('gamereg-entrypoint-')
  const vault = join(dir, 'vault')
  const config = join(dir, 'config')
  const defaults = join(dir, 'defaults')
  const bin = join(dir, 'bin')
  const home = join(dir, 'home')
  const log = join(dir, 'calls.log')
  const patch = join(dir, 'patch.log')
  const cron = join(dir, 'cron.json')

  for (const d of [vault, config, bin, home, join(defaults, 'skills', 'gamereg'), join(defaults, 'workspace')]) {
    mkdirSync(d, { recursive: true })
  }

  // Stand-ins for the real agent tree. Content is irrelevant to what is being
  // tested — which file is replaced and which is left alone is not.
  writeFileSync(join(defaults, 'skills', 'gamereg', 'SKILL.md'), 'shipped skill\n')
  writeFileSync(join(defaults, 'workspace', 'SOUL.md'), 'shipped persona\n')
  writeFileSync(join(defaults, 'workspace', 'AGENTS.md'), 'shipped card\n')
  writeFileSync(join(defaults, 'openclaw.json5'), '{ channels: { telegram: { enabled: true } } }\n')
  writeFileSync(join(defaults, 'exec-approvals.json'), '{"version":1}\n')

  writeFileSync(cron, '[]\n')

  const gamereg = join(bin, 'gamereg')
  writeFileSync(gamereg, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"\n`)
  chmodSync(gamereg, 0o755)

  // The stub. `cron list` answers from a file so a test can put a job in the
  // store; `config patch --stdin` drains stdin to a file so the environment
  // overlay can be inspected; everything else just records that it happened.
  const openclaw = join(bin, 'openclaw')
  writeFileSync(
    openclaw,
    [
      '#!/bin/sh',
      `echo "$*" >> ${JSON.stringify(log)}`,
      'if [ "$1" = "cron" ] && [ "$2" = "list" ]; then',
      `  cat ${JSON.stringify(cron)}`,
      '  exit 0',
      'fi',
      'for a in "$@"; do',
      '  if [ "$a" = "--stdin" ]; then',
      `    cat >> ${JSON.stringify(patch)}`,
      '    exit 0',
      '  fi',
      'done',
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(openclaw, 0o755)

  return {
    vault,
    config,
    defaults,
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []),
    patched: () => (existsSync(patch) ? readFileSync(patch, 'utf8') : ''),
    cronHolds: (name) => writeFileSync(cron, JSON.stringify([{ name }]) + '\n'),
    run: (mode, env = {}, args = []) => {
      const result = spawnSync('sh', [WRAPPER, mode, ...args], {
        encoding: 'utf8',
        env: {
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
          HOME: home,
          GAMEREG_VAULT: vault,
          OPENCLAW_STATE_DIR: config,
          GAMEREG_AGENT_DEFAULTS: defaults,
          TELEGRAM_BOT_TOKEN: 'token-123',
          TELEGRAM_ALLOW_FROM: '4242',
          GAMEREG_NON_INTERACTIVE: '1',
          ...env,
        },
      })
      return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
    },
  }
}

test('it refuses to start without a bot token', () => {
  const h = host()
  const r = h.run('gateway', { TELEGRAM_BOT_TOKEN: '' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /TELEGRAM_BOT_TOKEN/)
})

test('with no sender configured it starts in pairing rather than refusing', () => {
  // Refusing looks like the safe default and is a dead end: nobody can look up
  // their own Telegram user id. No official client shows it, and the Bot API
  // will not resolve a @username to one -- a bot only learns an id from
  // someone who has already written to it. So the gateway that refuses to boot
  // is the only thing that could have told you how to boot it.
  //
  // In pairing it answers with the id, a one-time code and the approve
  // command. A stranger can queue a request; they cannot get in.
  const h = host()
  const r = h.run('gateway', { TELEGRAM_ALLOW_FROM: '' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /pairing/i)

  const patched = h.patched()
  assert.match(patched, /dmPolicy: "pairing"/)
  assert.match(patched, /allowFrom: \[\]/, 'nobody is allowed in yet')
  assert.ok(!/execApprovals/.test(patched), 'no approver is known yet either')
})

test('with a sender configured the door is shut, and the pairing store is not consulted', () => {
  const h = host()
  const r = h.run('gateway', { TELEGRAM_ALLOW_FROM: '4242' })
  assert.equal(r.status, 0, r.stderr)

  const patched = h.patched()
  assert.match(patched, /dmPolicy: "allowlist"/)
  assert.match(patched, /allowFrom: \["4242"\]/)
  assert.match(patched, /approvers: \["4242"\]/)
})

test('a @username where a numeric chat id belongs is refused, not silently accepted', () => {
  // `openclaw config validate` calls a username-shaped allowlist valid, and
  // only `doctor` catches it -- so left alone it matches nobody and every
  // message is refused with no error anywhere. Better to stop at the door.
  const h = host()
  const r = h.run('gateway', { TELEGRAM_ALLOW_FROM: '@alcides' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /numeric/)
})

test('an empty vault is initialised, and a git repository created around it', () => {
  const h = host()
  const r = h.run('gateway', { GAMEREG_TIMEZONE: 'America/Sao_Paulo', GAMEREG_DAY_CUTOFF: '05:00' })
  assert.equal(r.status, 0, r.stderr)

  assert.ok(existsSync(join(h.vault, 'gamereg.config.json')), 'the vault was initialised')
  assert.ok(existsSync(join(h.vault, '.git')), 'the vault is a git repository')

  const config = JSON.parse(readFileSync(join(h.vault, 'gamereg.config.json'), 'utf8'))
  assert.equal(config.timezone, 'America/Sao_Paulo')
  assert.equal(config.day_cutoff, '05:00')
})

/**
 * `seed_vault()` used to guard both `gamereg init` and `git init` with the
 * same condition -- "no gamereg.config.json" -- so a vault mounted with a
 * config already in place (restored from a backup, copied in by hand, or one
 * predating the container) returned before ever becoming a git repository.
 * `scripts/autobuild.sh` treats "is the working tree dirty" as its entire
 * state, so a vault with no `.git` can never be picked up by it at all.
 */
test('a mounted vault that already has a config but no .git still becomes one', () => {
  const h = host()
  writeFileSync(
    join(h.vault, 'gamereg.config.json'),
    JSON.stringify({ locale: 'en', timezone: 'UTC', day_cutoff: '05:00' }),
  )

  const r = h.run('gateway', { GAMEREG_TIMEZONE: 'America/Sao_Paulo' })
  assert.equal(r.status, 0, r.stderr)

  assert.ok(existsSync(join(h.vault, '.git')), 'the vault must become a git repository')

  // The vault's own contents are never touched -- only "does .git exist" was
  // the missing check, not "is the vault already initialised".
  const config = JSON.parse(readFileSync(join(h.vault, 'gamereg.config.json'), 'utf8'))
  assert.equal(config.timezone, 'UTC', 'an existing config must not be reinitialised from the environment')
})

test('an existing vault is left exactly as it was', () => {
  const h = host()
  h.run('gateway')

  const before = readFileSync(join(h.vault, 'gamereg.config.json'), 'utf8')
  writeFileSync(join(h.vault, 'gamereg.config.json'), before.replace('"day_cutoff": "05:00"', '"day_cutoff": "03:00"'))

  const r = h.run('gateway', { GAMEREG_DAY_CUTOFF: '05:00' })
  assert.equal(r.status, 0, r.stderr)

  const after = JSON.parse(readFileSync(join(h.vault, 'gamereg.config.json'), 'utf8'))
  assert.equal(after.day_cutoff, '03:00', 'the environment did not overwrite a vault that already existed')
})

test('the skill is replaced on every boot, so a new image actually redeploys it', () => {
  const h = host()
  h.run('gateway')

  const deployed = join(h.config, 'workspace', 'skills', 'gamereg', 'SKILL.md')
  assert.equal(readFileSync(deployed, 'utf8'), 'shipped skill\n')

  // Stale copy from a previous image, plus a file that image no longer ships.
  writeFileSync(deployed, 'stale skill\n')
  writeFileSync(join(h.config, 'workspace', 'skills', 'gamereg', 'GONE.md'), 'removed upstream\n')

  h.run('gateway')
  assert.equal(readFileSync(deployed, 'utf8'), 'shipped skill\n', 'the skill was replaced')
  assert.ok(
    !existsSync(join(h.config, 'workspace', 'skills', 'gamereg', 'GONE.md')),
    'a file the image no longer ships does not survive as a leftover',
  )
})

/**
 * AGENTS.md is code, not persona. It spent a release seeded like a persona
 * file, so an image upgrade shipped new behaviour with the old standing orders
 * and nothing said a word.
 */
test('the standing orders are replaced on every boot even when they were edited', () => {
  const h = host()
  const first = h.run('gateway')

  const card = join(h.config, 'workspace', 'AGENTS.md')
  assert.equal(readFileSync(card, 'utf8'), 'shipped card\n')

  // A first boot has to say the card was deployed. Without it the two most
  // important files are the only ones a clean boot is silent about, and "did
  // my new AGENTS.md land?" has no line to read.
  assert.match(first.stderr, /deploying AGENTS\.md/)

  // And then stays quiet while nothing changes.
  assert.doesNotMatch(h.run('gateway').stderr, /AGENTS\.md/)

  writeFileSync(card, 'stale card\n')
  h.run('gateway')
  assert.equal(readFileSync(card, 'utf8'), 'shipped card\n', 'an upgrade must redeploy the card')

  // Overwriting is not the same as discarding: what was there is kept where a
  // person can find it, and under a name that is not *.md so it cannot rejoin
  // the system prompt.
  const backups = readdirSync(join(h.config, 'backups'))
  assert.ok(
    backups.some((name) => name.startsWith('AGENTS.md.replaced-')),
    `the replaced card was not kept: ${backups.join(', ')}`,
  )
  assert.ok(!backups.some((name) => name.endsWith('.md')), 'a backup must not be a workspace file')
})

test('a seeded file the user never touched follows the shipped version', () => {
  const h = host()
  h.run('gateway')

  const soul = join(h.config, 'workspace', 'SOUL.md')
  assert.equal(readFileSync(soul, 'utf8'), 'shipped persona\n')

  // A new image, same untouched file. Nobody should have to do anything.
  writeFileSync(join(h.defaults, 'workspace', 'SOUL.md'), 'shipped persona v2\n')
  const r = h.run('gateway')
  assert.equal(readFileSync(soul, 'utf8'), 'shipped persona v2\n', 'an untouched file must follow the image')
  assert.match(r.stderr, /updating SOUL\.md/)
})

test('a seeded file the user edited is kept, and the boot says how to take the new one', () => {
  const h = host()
  h.run('gateway')

  const soul = join(h.config, 'workspace', 'SOUL.md')
  writeFileSync(soul, 'my own voice\n')

  // Same image: their edit survives and nothing is said, because nothing
  // happened worth saying.
  const quiet = h.run('gateway')
  assert.equal(readFileSync(soul, 'utf8'), 'my own voice\n')
  assert.doesNotMatch(quiet.stderr, /NOTICE/, 'an unchanged default must not nag')

  // New image: their edit still survives, and now it is worth saying so.
  writeFileSync(join(h.defaults, 'workspace', 'SOUL.md'), 'shipped persona v2\n')
  const loud = h.run('gateway')
  assert.equal(readFileSync(soul, 'utf8'), 'my own voice\n', 'an edit is never overwritten')
  assert.match(loud.stderr, /NOTICE: SOUL\.md is yours/)
  assert.match(loud.stderr, /delete it from the workspace/, 'the notice must name the way out')

  // Every line of a notice carries the log prefix, asserted on the *last* line
  // specifically. The first version embedded a newline in one `log` call, so
  // the continuation came out unprefixed and vanished from
  // `docker logs | grep entrypoint`, which is how a boot is actually read.
  //
  // Matching `^entrypoint: ` against lines containing "NOTICE" does not catch
  // that -- the orphaned line does not contain the word -- which is the same
  // filter swallowing the same line one layer up. So the anchor is the text
  // that was being lost.
  assert.match(loud.stderr, /^entrypoint: .*Keeping yours\./m, 'the last notice line lost its prefix')
})

/**
 * The way out the notice promises. Untested, it is the sort of sentence that
 * is true when written and wrong two releases later.
 */
test('deleting a seeded file takes the shipped version and resumes tracking', () => {
  const h = host()
  h.run('gateway')

  const soul = join(h.config, 'workspace', 'SOUL.md')
  writeFileSync(soul, 'my own voice\n')
  writeFileSync(join(h.defaults, 'workspace', 'SOUL.md'), 'shipped persona v2\n')
  h.run('gateway')

  rmSync(soul)
  h.run('gateway')
  assert.equal(readFileSync(soul, 'utf8'), 'shipped persona v2\n')

  // Tracking resumed, so the next image updates it again with no notice.
  writeFileSync(join(h.defaults, 'workspace', 'SOUL.md'), 'shipped persona v3\n')
  const r = h.run('gateway')
  assert.equal(readFileSync(soul, 'utf8'), 'shipped persona v3\n')
  assert.doesNotMatch(r.stderr, /NOTICE/)
})

/**
 * Installs that predate the hash record. There is no way to tell an edit from
 * a default that has since moved, and guessing in the permissive direction
 * deletes somebody's writing.
 */
test('an untracked file identical to the shipped default is adopted', () => {
  const h = host()
  const workspace = join(h.config, 'workspace')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'SOUL.md'), 'shipped persona\n')

  const r = h.run('gateway')
  assert.match(r.stderr, /adopting SOUL\.md/)

  writeFileSync(join(h.defaults, 'workspace', 'SOUL.md'), 'shipped persona v2\n')
  h.run('gateway')
  assert.equal(readFileSync(join(workspace, 'SOUL.md'), 'utf8'), 'shipped persona v2\n')
})

test('an untracked file that differs is kept, loudly, and not adopted', () => {
  const h = host()
  const workspace = join(h.config, 'workspace')
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, 'SOUL.md'), 'from an older image, maybe mine\n')

  const r = h.run('gateway')
  assert.equal(readFileSync(join(workspace, 'SOUL.md'), 'utf8'), 'from an older image, maybe mine\n')
  assert.match(r.stderr, /NOTICE: SOUL\.md was not updated/)
  assert.match(r.stderr, /^entrypoint: .*predates seed tracking/m, 'the reason must survive a filtered log')

  // Not adopted: a later image must not silently overwrite it either.
  writeFileSync(join(h.defaults, 'workspace', 'SOUL.md'), 'shipped persona v2\n')
  h.run('gateway')
  assert.equal(
    readFileSync(join(workspace, 'SOUL.md'), 'utf8'),
    'from an older image, maybe mine\n',
    'an unadopted file stays the user\'s until they act',
  )
})

/**
 * The diary memory-core writes nightly, which lands in the system prompt and
 * grows there. The sweep is turned off in the config; this is the copy it
 * already wrote.
 */
/**
 * OpenClaw 2026.9.4 dropped TOOLS.md and HEARTBEAT.md from the list it injects
 * into the prompt, so a workspace still holding them holds bytes no turn reads
 * — and `openclaw doctor` reports a migration that a re-seeding boot undoes
 * every time. Retired alongside DREAMS.md, for one reason.
 */
test('files OpenClaw no longer injects are moved out of an existing workspace', () => {
  const h = host()
  h.run('gateway')

  const workspace = join(h.config, 'workspace')
  for (const name of ['TOOLS.md', 'HEARTBEAT.md']) {
    writeFileSync(join(workspace, name), `left by an older image: ${name}\n`)
  }
  // A seed hash from when they were shipped: it must go too, or a later boot
  // treats the file as adopted and tracked.
  mkdirSync(join(h.config, '.gamereg-seed'), { recursive: true })
  writeFileSync(join(h.config, '.gamereg-seed', 'TOOLS.md.sha256'), 'stale\n')

  const r = h.run('gateway')
  for (const name of ['TOOLS.md', 'HEARTBEAT.md']) {
    assert.ok(!existsSync(join(workspace, name)), `${name} must leave the workspace`)
    assert.match(
      readFileSync(join(h.config, name), 'utf8'),
      new RegExp(name),
      `${name} must be kept outside the workspace, not deleted`,
    )
  }
  assert.ok(
    !existsSync(join(h.config, '.gamereg-seed', 'TOOLS.md.sha256')),
    'a retired file must not keep its seed hash',
  )
  assert.match(r.stderr, /moving TOOLS\.md out of the workspace/)
})

test('the shipped workspace no longer carries the files OpenClaw dropped', () => {
  // The image ships what the entrypoint deploys; if these come back, every
  // boot re-creates what the boot before it retired.
  for (const name of ['TOOLS.md', 'HEARTBEAT.md']) {
    assert.ok(
      !existsSync(join(ROOT, 'agent', 'workspace', name)),
      `agent/workspace/${name} is shipped again, which the retirement above would fight every boot`,
    )
  }
})

test('an existing dream diary is moved out of the workspace, not deleted', () => {
  const h = host()
  h.run('gateway')

  const diary = join(h.config, 'workspace', 'DREAMS.md')
  writeFileSync(diary, '# Dream Diary\n\nLast night I dreamt in timestamps.\n')

  h.run('gateway')
  assert.ok(!existsSync(diary), 'the diary must leave the workspace')
  assert.match(
    readFileSync(join(h.config, 'DREAMS.md'), 'utf8'),
    /dreamt in timestamps/,
    'the diary is the user\'s prose about their own sessions and is kept',
  )
})

/**
 * The fallback chain was unreachable for two months of rate limits.
 *
 * OpenClaw 2026.9.4 retries the same model before considering the chain, and
 * on a 429 it sleeps for the provider's `Retry-After`. Anthropic asked for 41
 * to 260 minutes across five real incidents; the turn is abandoned after about
 * six. So every rate limit ended in "this turn was interrupted because it
 * stopped making progress" while OpenRouter sat configured, credentialed and
 * idle. Zero is what makes a refusal hand over instead of wait.
 */
test('the boot sets the provider retry budget to zero', () => {
  const h = host()
  h.run('gateway')

  const settings = JSON.parse(
    readFileSync(join(h.config, 'agents', 'main', 'agent', 'settings.json'), 'utf8'),
  ) as { retry?: { provider?: { maxRetries?: number } } }
  assert.equal(settings.retry?.provider?.maxRetries, 0)
})

test('the retry budget is settable, because a lone model has nothing to fail over to', () => {
  const h = host()
  h.run('gateway', { OPENCLAW_PROVIDER_MAX_RETRIES: '3' })

  const settings = JSON.parse(
    readFileSync(join(h.config, 'agents', 'main', 'agent', 'settings.json'), 'utf8'),
  ) as { retry?: { provider?: { maxRetries?: number } } }
  assert.equal(settings.retry?.provider?.maxRetries, 3)
})

/**
 * OpenClaw persists its own settings in this file. Overwriting it would throw
 * away whatever the gateway had written there.
 */
test('writing the retry budget keeps everything else in settings.json', () => {
  const h = host()
  const dir = join(h.config, 'agents', 'main', 'agent')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ hideThinkingBlock: true, retry: { enabled: true, provider: { timeoutMs: 1234 } } }),
  )

  h.run('gateway')

  const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
  assert.equal(settings['hideThinkingBlock'], true, 'an unrelated setting was discarded')
  const retry = settings['retry'] as { enabled?: boolean; provider?: Record<string, unknown> }
  assert.equal(retry.enabled, true, 'a sibling of retry.provider was discarded')
  assert.equal(retry.provider?.['timeoutMs'], 1234, 'a sibling inside retry.provider was discarded')
  assert.equal(retry.provider?.['maxRetries'], 0)
})

/**
 * With the same-model retry off, depth in the chain is what depth in retries
 * used to be -- and it costs no waiting on the model that just refused.
 */
test('the fallback chain takes more than one model', () => {
  const h = host()
  h.run('gateway', {
    OPENCLAW_MODEL: 'anthropic/claude-sonnet-5',
    OPENCLAW_MODEL_FALLBACK: 'openrouter/auto, openrouter/anthropic/claude-sonnet-5',
  })

  assert.match(h.patched(), /fallbacks: \["openrouter\/auto", "openrouter\/anthropic\/claude-sonnet-5"\]/)
})

test('an empty fallback chain stays empty rather than becoming one empty string', () => {
  const h = host()
  h.run('gateway', { OPENCLAW_MODEL: 'anthropic/claude-sonnet-5', OPENCLAW_MODEL_FALLBACK: '' })
  assert.match(h.patched(), /fallbacks: \[\]/)
})

test('the boot turns the dreaming sweep off', () => {
  const h = host()
  h.run('gateway')
  assert.match(h.patched(), /"memory-core": \{ config: \{ dreaming: \{ enabled: false \} \} \}/)
})

test('a Claude Code OAuth token goes into the auth store, never into the config', () => {
  // The distinction cost two deployments. Setting the variable and writing an
  // `anthropic:cli` profile into the config is what an onboarded host looks
  // like and authenticates nothing -- the gateway starts clean and fails at
  // the first message. `paste-token` writes the per-agent store, which is what
  // the provider actually reads, and a real turn then comes back from
  // Anthropic with no fallback.
  const h = host()
  const r = h.run('gateway', { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-whatever' })
  assert.equal(r.status, 0, r.stderr)

  const paste = h.calls().find((c) => c.includes('paste-token'))
  assert.ok(paste, 'the token must be pasted into the auth store')
  assert.match(paste, /--provider anthropic/)

  // The shape that does not work is a *model* auth profile in the config --
  // `auth: { profiles: { "anthropic:cli": ... } }`, which looks exactly like
  // configuration and authenticates nothing. `gateway.auth` is a different
  // key with a different job (the gateway's own token, which the overlay does
  // carry on purpose), so this matches the dangerous shape rather than the
  // word.
  const patched = h.patched()
  assert.ok(!/anthropic:cli/.test(patched), 'no model auth profile in the config')
  assert.ok(!/profiles:/.test(patched), 'and no auth profiles block at all')
})

/**
 * `configure_model_auth` used to return the instant `.gamereg-auth-seeded`
 * existed, with no regard for what it was seeded from. Replacing an expired
 * `CLAUDE_CODE_OAUTH_TOKEN` in `.env` and restarting therefore did nothing --
 * the store kept whatever the first token had written, silently, until
 * something finally tried to use the model and failed.
 */
test('a changed CLAUDE_CODE_OAUTH_TOKEN is re-pasted into the auth store', () => {
  const h = host()

  const first = h.run('gateway', { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-first' })
  assert.equal(first.status, 0, first.stderr)
  assert.equal(h.calls().filter((c) => c.includes('paste-token')).length, 1)

  // The token that was pasted never lands in the sentinel, in any form a
  // grep would find.
  const seeded = readFileSync(join(h.config, '.gamereg-auth-seeded'), 'utf8')
  assert.ok(!seeded.includes('sk-ant-oat-first'), 'the sentinel must not carry the token itself')

  // Same token, second boot: still exactly one paste, same as before this fix.
  const again = h.run('gateway', { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-first' })
  assert.equal(again.status, 0, again.stderr)
  assert.equal(h.calls().filter((c) => c.includes('paste-token')).length, 1, 'an unchanged token is not re-pasted')

  // A new token in .env, restart: the old behaviour silently kept the expired
  // one. It must be pasted again.
  const rotated = h.run('gateway', { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-second' })
  assert.equal(rotated.status, 0, rotated.stderr)
  assert.equal(
    h.calls().filter((c) => c.includes('paste-token')).length,
    2,
    'a changed token must be re-pasted into the auth store',
  )
})

test('the model is chosen separately from the credential', () => {
  // They used to be one step, so the model was a side effect of whichever auth
  // branch ran and picking Anthropic after an OpenRouter key was present meant
  // editing the config by hand.
  const h = host()
  h.run('gateway', {
    OPENROUTER_API_KEY: 'k',
    OPENCLAW_MODEL: 'anthropic/claude-sonnet-5',
    OPENCLAW_MODEL_FALLBACK: 'openrouter/auto',
  })
  const patched = h.patched()
  assert.match(patched, /primary: "anthropic\/claude-sonnet-5"/)
  assert.match(patched, /fallbacks: \["openrouter\/auto"\]/)
})

test('the shipped config is seeded once, and the environment overlay applied every boot', () => {
  const h = host()
  h.run('gateway')

  const seeds = h.calls().filter((c) => c.includes('config patch --file'))
  assert.equal(seeds.length, 1)

  h.run('gateway')
  assert.equal(h.calls().filter((c) => c.includes('config patch --file')).length, 1, 'the seed is not reapplied')
  assert.equal(
    h.calls().filter((c) => c.includes('config patch --stdin')).length,
    2,
    'the environment overlay runs on every boot',
  )

  const patched = h.patched()
  // The one that produces no error at all when it is wrong: the shipped
  // example's "~/.openclaw/workspace" is a host path, and inside the container
  // it resolves next to the state directory instead of into it. The agent then
  // starts with no persona and no skill and answers like a stock assistant.
  assert.match(patched, /workspace: "[^"]*\/workspace"/)
  assert.ok(!/~/.test(patched), 'the container config must not lean on ~ expansion')
  assert.match(patched, /botToken: "token-123"/)
  assert.match(patched, /allowFrom: \["4242"\]/)
  assert.match(patched, /dmPolicy: "allowlist"/)
})

/**
 * The allowlist is seeded through `openclaw approvals set`, not by copying a
 * file into place. OpenClaw 2026.9 moved the store from
 * `$STATE_DIR/exec-approvals.json` into `state/openclaw.sqlite`, and the
 * failure mode of the old approach is the nasty kind: the gateway boots fine
 * and then every message fails with `ExecApprovalsMigrationRequiredError`.
 * Asking the installed CLI to write its own store is what survives the next
 * move; a sentinel keeps the seed to first boot so an edited allowlist is not
 * overwritten.
 */
/**
 * The gateway reads its auth token from the config; every CLI client -- the
 * provision service, `cron add`, a `compose exec` -- reads `.gateway-token`.
 * Let those diverge and the clients are locked out with `token_mismatch`
 * while the gateway itself looks perfectly healthy, which is exactly what the
 * 2026.9.4 upgrade produced: `doctor --fix` minted a token for a config that
 * had none, and provision could not reach the gateway it was there to
 * configure. The file is the authority and the overlay restates it every boot.
 */
test('the gateway token in the config is the one in .gateway-token', () => {
  const h = host()
  h.run('gateway')

  const token = readFileSync(join(h.config, '.gateway-token'), 'utf8').trim()
  assert.ok(token.length > 0)
  assert.match(h.patched(), new RegExp(`token: "${token}"`), 'the overlay carries the file\'s token')
})

/**
 * A config written by an older OpenClaw can stop validating after an upgrade,
 * and the repair has to happen before anything else reads it. It used to sit
 * inside configure_gateway, which is late: `configure_model` runs first, hit
 * the invalid config, and the container went into a restart loop. That did
 * not show up in the test rig because the rig has no model credential, so the
 * step it broke on was skipped.
 */
test('a config that does not validate is repaired before anything else reads it', () => {
  const h = host()
  h.run('gateway')

  const calls = h.calls()
  const doctor = calls.findIndex((c) => c.includes('doctor --fix'))
  if (doctor === -1) return // nothing to repair in this rig; the ordering test below still holds

  const firstConfigRead = calls.findIndex((c) => c.startsWith('config ') || c.startsWith('models '))
  assert.ok(doctor < firstConfigRead, 'doctor --fix runs before the first config-dependent call')
})

test('the exec allowlist is seeded through the CLI, once', () => {
  const h = host()
  h.run('gateway')

  const seeds = h.calls().filter((c) => c.includes('approvals set --file'))
  assert.equal(seeds.length, 1, 'seeded exactly once')
  assert.ok(existsSync(join(h.config, '.gamereg-approvals-seeded')))

  h.run('gateway')
  assert.equal(
    h.calls().filter((c) => c.includes('approvals set --file')).length,
    1,
    'a second boot does not reseed, so an edited allowlist survives',
  )
})

/**
 * An image upgraded in place inherits the legacy file, and its mere presence
 * is what the new gateway refuses to start work with.
 */
test('a legacy exec-approvals.json left by an older image is removed', () => {
  const h = host()
  const legacy = join(h.config, 'exec-approvals.json')
  writeFileSync(legacy, '{"version":1,"agents":{}}\n')

  h.run('gateway')
  assert.equal(existsSync(legacy), false, 'the legacy file blocks the new store and has to go')
})

test('git gets an identity and the vault an ownership exception, or the first commit aborts', () => {
  const h = host()
  h.run('gateway', { GAMEREG_GIT_NAME: 'Veronika', GAMEREG_GIT_EMAIL: 'v@example.org' })

  const home = join(h.vault, '..', 'home')
  const gitconfig = readFileSync(join(home, '.gitconfig'), 'utf8')
  assert.match(gitconfig, /name = Veronika/)
  assert.match(gitconfig, /email = v@example\.org/)
  assert.match(gitconfig, /safe/)
  assert.ok(gitconfig.includes(h.vault), 'the bind-mounted vault is exempted from the ownership check')
})

test('the ownership exception is not appended again on every boot', () => {
  const h = host()
  h.run('gateway')
  h.run('gateway')
  h.run('gateway')

  const home = join(h.vault, '..', 'home')
  const entries = readFileSync(join(home, '.gitconfig'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(h.vault))
  assert.equal(entries.length, 1, 'three boots left one entry, not three')
})

test('the gateway is never started by the entrypoint before the vault is ready', () => {
  const h = host()
  const r = h.run('gateway', { TELEGRAM_BOT_TOKEN: '' })
  assert.equal(r.status, 2)
  assert.ok(!existsSync(join(h.vault, 'gamereg.config.json')), 'preflight ran before anything was written')
  assert.deepEqual(h.calls(), [], 'and before the gateway was touched at all')
})

test('provision registers the check-in job against a running gateway', () => {
  const h = host()
  const r = h.run('provision', { GAMEREG_CHECKIN_TO: '4242', GAMEREG_CHECKIN_CHANNEL: 'telegram' })
  assert.equal(r.status, 0, r.stderr)

  const add = h.calls().find((c) => c.startsWith('cron add'))
  assert.ok(add, 'a job was registered')

  // `--every` counts from registration, so an aligned hourly cron plus
  // `--exact` is what keeps the morning delivery slot on the hour.
  assert.match(add, /--cron 0 \* \* \* \*/)
  assert.match(add, /--exact/)
  assert.match(add, /--no-deliver/)
  assert.match(add, new RegExp(`--command-env GAMEREG_VAULT=${h.vault}`))
  assert.match(add, /--command-env GAMEREG_CHECKIN_TO=4242/)
})

test('provision is idempotent: a job already in the store is not registered twice', () => {
  const h = host()
  h.cronHolds('gamereg-checkin')

  const r = h.run('provision')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(
    !h.calls().some((c) => c.startsWith('cron add')),
    'the existing job was recognised rather than duplicated',
  )
})

test('an unknown mode is executed verbatim, so one-off commands still work', () => {
  const h = host()
  const r = h.run('gamereg', {})
  // `gamereg` with no arguments is a usage error from the real CLI, which is
  // proof enough that the entrypoint got out of the way and exec'd it.
  assert.notEqual(r.status, 0)
  assert.deepEqual(h.calls(), [], 'no gateway setup ran for a one-off command')
})

test('--dry-run touches nothing', () => {
  const h = host()
  const r = spawnSync('sh', [WRAPPER, 'gateway', '--dry-run'], {
    encoding: 'utf8',
    env: {
      PATH: `${join(h.vault, '..', 'bin')}:${process.env['PATH'] ?? ''}`,
      HOME: join(h.vault, '..', 'home'),
      GAMEREG_VAULT: h.vault,
      OPENCLAW_STATE_DIR: h.config,
      GAMEREG_AGENT_DEFAULTS: h.defaults,
      TELEGRAM_BOT_TOKEN: 'token-123',
      TELEGRAM_ALLOW_FROM: '4242',
    },
  })

  assert.equal(r.status ?? -1, 0, r.stderr)
  assert.ok(!existsSync(join(h.vault, 'gamereg.config.json')), 'no vault was initialised')
  assert.ok(!existsSync(join(h.config, 'workspace')), 'no agent files were deployed')
  assert.deepEqual(h.calls(), [], 'the gateway was never invoked')
})

test('provision --dry-run reaches no gateway either', () => {
  // `--dry-run` is documented as performing nothing, and `cron list` is a
  // Gateway *client* call: it opens a connection. The gate was on `cron add`
  // alone, so the probe ran for real -- which is exactly the call a dry run of
  // this mode is meant to be safe to make without a gateway existing.
  const h = host()
  const r = h.run('provision', {}, ['--dry-run'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(h.calls(), [], 'the gateway was never contacted')
})

test('a value from the environment cannot add keys to the gateway config', () => {
  // Every interpolation into the JSON5 patches goes through json_escape. The
  // failure this prevents is not a syntax error somebody notices: `config
  // patch` merges whatever parses, so an unescaped quote turns a value into
  // more configuration.
  const h = host()
  const r = h.run('gateway', {
    TELEGRAM_BOT_TOKEN: 'tok", "dmPolicy": "open',
    OPENCLAW_MODEL: 'anthropic/claude-sonnet-5", "temperature": 2',
  })
  assert.equal(r.status, 0, r.stderr)

  const patched = h.patched()
  // Neither injected key is ever written as a key. `dmPolicy` appears as one
  // exactly where the template puts it, carrying the template's own value;
  // `temperature` never appears as one at all.
  assert.match(patched, /^\s*dmPolicy: "allowlist",$/m)
  assert.ok(!/^\s*"?dmPolicy"?:\s*"open"/m.test(patched), patched)
  assert.ok(!/^\s*"?temperature"?:/m.test(patched), patched)
  // And the value survives escaped rather than being dropped or the boot
  // aborted, so a legitimate value containing a quote still configures.
  assert.match(patched, /tok\\", \\"dmPolicy\\": \\"open/)
  assert.match(patched, /claude-sonnet-5\\", \\"temperature\\": 2/)
})

test('the real defaults tree is the one the Dockerfile copies', () => {
  // Guards the seam between this test's stand-ins and what actually ships: if
  // the repository stops holding one of these, the image's COPY silently
  // produces an empty directory and every boot deploys nothing.
  for (const path of [
    join(ROOT, 'agent', 'skills', 'gamereg', 'SKILL.md'),
    join(ROOT, 'agent', 'workspace', 'AGENTS.md'),
    join(ROOT, 'agent', 'openclaw.example.json5'),
    join(ROOT, 'agent', 'approvals.example.json'),
    join(ROOT, 'agent', 'checkin.sh'),
    join(ROOT, 'scripts', 'autobuild.sh'),
    join(ROOT, 'docker', 'loop.sh'),
    join(ROOT, 'docker', 'site-loop.sh'),
  ]) {
    assert.ok(existsSync(path), `${path} is referenced by the Dockerfile and must exist`)
  }

  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
  assert.ok(!/docker\.sock/.test(dockerfile), 'the image never asks for the Docker socket')

  // Compose overrides the image's USER with the host's uid, and Docker falls
  // back to HOME=/ when that uid is not in /etc/passwd. `git config --global`
  // then fails silently and the vault's first commit aborts -- on a host whose
  // uid happens to be 1000 it all works, which is the coincidence a container
  // exists to remove.
  assert.match(dockerfile, /ENV HOME=\/config/, 'HOME must not depend on the uid resolving')

  const compose = readFileSync(join(ROOT, 'compose.yml'), 'utf8')
  assert.ok(
    !/^\s*-\s*\/var\/run\/docker\.sock/m.test(compose),
    'no service mounts the Docker socket: the gateway runs a model with shell access',
  )
})

/**
 * The builder stage does `COPY . .` over the whole build context (Dockerfile
 * line ~36); the runtime stage only ever copies the npm pack tarball out of
 * it, so a secret in `.env` never reaches the final image. It does land in a
 * local builder layer and the build cache, though, for anyone who builds from
 * a checkout with a filled `.env` -- which `compose.build.yml` invites.
 */
test('.env never enters the build context, .env.example still does', () => {
  const ignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8')
  const lines = ignore.split('\n').map((line) => line.trim())

  assert.ok(lines.includes('.env'), '.dockerignore must exclude .env')
  assert.ok(lines.includes('.env.*'), '.dockerignore must exclude every .env.* variant (.env.local, etc.)')
  assert.ok(
    lines.includes('!.env.example'),
    '.env.example is documentation, not a secret, and must be re-included after the .env.* exclusion',
  )

  // Order matters for a negation to take effect: docker (like git) applies
  // patterns top to bottom, so the re-inclusion has to come after the
  // exclusion it is undoing.
  assert.ok(lines.indexOf('!.env.example') > lines.indexOf('.env.*'))
})

test('a bare `compose up` starts the register and nothing that would exhaust a 1 GB machine', () => {
  // The reason this is worth a test rather than a comment: the numbers that
  // make the site profile a bad idea here -- a Quartz build's 400-700 MB peak
  // against a gateway already holding 250-400, and 1 GB of monthly egress
  // against a vault of cover art -- are invisible in a diff. Dropping a
  // `profiles:` key reads as tidying and takes the gateway down with the OOM
  // killer on the next content change.
  const compose = parse(readFileSync(join(ROOT, 'compose.yml'), 'utf8')) as {
    services: Record<string, { profiles?: string[] }>
  }

  const byProfile = (name: string | null) =>
    Object.keys(compose.services)
      .filter((s) => (name === null ? !compose.services[s]?.profiles : compose.services[s]?.profiles?.includes(name)))
      .sort()

  assert.deepEqual(byProfile(null), ['gateway', 'maintenance', 'provision'])
  assert.deepEqual(byProfile('site'), ['site-build', 'site-serve'])

  // Remark42 and the tunnel answer different questions -- what runs here, and
  // what may reach in from outside -- so they are separate profiles. Bundled,
  // the `site` profile could not have comments without a Cloudflare account,
  // which is the one thing that profile exists to avoid.
  assert.deepEqual(byProfile('comments'), ['remark42'])
  assert.deepEqual(byProfile('tunnel'), ['tunnel'])
})

test('compose.yml runs from a published image, with no build context', () => {
  // The exit criterion for this phase is someone installing without cloning
  // anything. A `build:` key in compose.yml makes a checkout a prerequisite,
  // and it silently did: the committed file was hand-edited on its way to the
  // production host to strip that key, so the artifact a stranger would get
  // was never the artifact anyone actually ran. Development builds through
  // compose.build.yml instead.
  const raw = readFileSync(join(ROOT, 'compose.yml'), 'utf8')
  const compose = parse(raw) as { services: Record<string, { build?: unknown }> }

  for (const [name, service] of Object.entries(compose.services)) {
    assert.equal(service.build, undefined, `${name} must not carry a build context`)
  }
  assert.match(raw, /image: ghcr\.io\/cidus\/gamereg:\$\{GAMEREG_IMAGE_TAG:-edge\}/)

  // And the override exists and covers every service built from this image, so
  // a developer is never silently running a stale published one.
  const override = parse(readFileSync(join(ROOT, 'compose.build.yml'), 'utf8')) as {
    services: Record<string, { build?: { context?: string } }>
  }
  const fromImage = Object.entries(compose.services)
    .filter(([, s]) => JSON.stringify(s).includes('GAMEREG_IMAGE_TAG'))
    .map(([n]) => n)
    .sort()
  assert.deepEqual(Object.keys(override.services).sort(), fromImage)
})

test('the image is published only from main, and never as latest', () => {
  // Three properties, each of which fails silently if dropped.
  //
  // A pull request from a branch *in this repository* carries a GITHUB_TOKEN
  // that can write packages -- unlike one from a fork -- so the event guard is
  // what stands between an unreviewed branch and the registry.
  //
  // `verify` is the gate: it runs the entrypoint and diffs a clean-room build
  // against the goldens. An image that fails that must not become pullable.
  //
  // And there is no `:latest` until 1.0.0. Publishing is a one-way door
  // (06-roadmap.md) and `:latest` is what reads as "safe to depend on" to
  // someone who was never told it is a preview.
  const workflow = parse(readFileSync(join(ROOT, '.github', 'workflows', 'image.yml'), 'utf8')) as {
    jobs: Record<string, { needs?: string | string[]; if?: string }>
  }
  // Comments stripped first: the header explains at length that there is no
  // `:latest`, and a scan over the prose finds the very word it forbids.
  const raw = readFileSync(join(ROOT, '.github', 'workflows', 'image.yml'), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')

  for (const name of ['build', 'publish']) {
    const job = workflow.jobs[name]
    assert.ok(job, `image.yml has a ${name} job`)
    assert.match(String(job.if), /github\.event_name == 'push'/, `${name} must not run on a pull request`)
  }

  const needs = (j?: { needs?: string | string[] }) => [j?.needs ?? []].flat()
  assert.deepEqual(needs(workflow.jobs['build']), ['verify'], 'build must wait for the verification job')
  assert.deepEqual(needs(workflow.jobs['publish']), ['build'], 'publish must wait for both architectures')

  assert.doesNotMatch(raw, /:latest/, 'no :latest tag before 1.0.0')
  assert.match(raw, /--tag "\$\{IMAGE\}:edge"/, 'edge is the moving tag')
})

test('the publicly reachable service never gets the whole .env', () => {
  // Compose loads an env_file wholesale, not the keys a service renames. With
  // one on remark42 -- the only thing here a stranger can reach -- the running
  // container held the model credential, the Telegram bot token, the tunnel
  // token and the IGDB keys, none of which it reads. Verified against a live
  // deployment before this was removed.
  const compose = parse(readFileSync(join(ROOT, 'compose.yml'), 'utf8')) as {
    services: Record<string, { env_file?: unknown; environment?: Record<string, string> }>
  }

  assert.equal(compose.services['remark42']?.env_file, undefined)
  assert.equal(compose.services['tunnel']?.env_file, undefined)

  // And a boolean flag must carry an explicit false: Remark42 reads a
  // variable's presence as enable, so AUTH_TELEGRAM="" advertises a sign-in
  // method that then fails against the Telegram API with an empty token.
  const env = compose.services['remark42']?.environment ?? {}
  for (const [key, value] of Object.entries(env)) {
    if (/^AUTH_(ANON|TELEGRAM)$/.test(key)) {
      assert.match(String(value), /:-false\}$/, `${key} must default to false, not empty`)
    }
  }
})

test('every auth provider .env.example advertises actually reaches Remark42', () => {
  // The cost of dropping remark42's env_file is that a provider now needs a
  // line in compose.yml as well as a value in .env. Forgetting the compose
  // half fails in perfect silence -- Remark42 never sees the variable, so the
  // provider is just absent from the sign-in panel, with nothing in any log.
  //
  // Two providers were advertised here and not wired for exactly one commit.
  // This is what makes that a failing test rather than a discovery.
  const env = readFileSync(join(ROOT, '.env.example'), 'utf8')
  const compose = parse(readFileSync(join(ROOT, 'compose.yml'), 'utf8')) as {
    services: Record<string, { environment?: Record<string, string> }>
  }
  const passed = new Set(Object.keys(compose.services['remark42']?.environment ?? {}))

  // Named in a value position or in the prose that offers them; both are a
  // promise to the reader.
  const advertised = new Set(env.match(/\bAUTH_[A-Z]+(?:_(?:CID|CSEC))?\b/g) ?? [])
  assert.ok(advertised.size > 0, 'the file still documents auth providers')

  const missing = [...advertised].filter((name) => !passed.has(name)).sort()
  assert.deepEqual(missing, [], `advertised in .env.example, never passed through: ${missing.join(', ')}`)
})

test('no service declares a required variable, because that breaks every other service', () => {
  // Found by running it. Compose interpolates the whole file before it filters
  // by profile, so a single `${VAR:?message}` in an opt-in service makes every
  // command fail for everyone who never enables that profile -- `config`,
  // `up`, all of it. It reads like the more helpful error and is the opposite.
  const compose = readFileSync(join(ROOT, 'compose.yml'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line)) // the comment explaining this names the syntax
    .join('\n')
  const required = compose.match(/\$\{[A-Z_]+:\?[^}]*\}/g)
  assert.equal(required, null, `remove the required-variable syntax: ${required?.join(', ')}`)
})

test('the gateway health check carries a token, or nothing ever becomes healthy', () => {
  // `openclaw gateway health` exits 1 without one -- reachable, but no
  // credentials for read-scope RPCs -- so a bare check marks the gateway
  // permanently unhealthy, and `provision` waits on exactly that condition.
  const compose = parse(readFileSync(join(ROOT, 'compose.yml'), 'utf8')) as {
    services: Record<string, { healthcheck?: { test?: string[] }; network_mode?: string }>
  }

  // And it must not be a Node process. `openclaw gateway health` costs 0.4s on
  // a laptop and minutes on a shared 0.25 vCPU, which is longer than the
  // interval -- checks pile up, and on a real e2-micro a dozen of them pushed
  // the load average past 30 and starved the boot they were waiting on.
  const check = compose.services['gateway']?.healthcheck?.test?.join(' ') ?? ''
  assert.match(check, /dev\/tcp/, 'the health check must be a bare TCP connect')
  assert.ok(!/openclaw|gamereg|node/.test(check), `the health check spawns a process: ${check}`)

  // And provision reaches it over a shared loopback: OpenClaw refuses
  // plaintext ws:// to any non-loopback address, so the compose network is not
  // a route to it without terminating TLS between two local containers.
  assert.equal(compose.services['provision']?.network_mode, 'service:gateway')
})
