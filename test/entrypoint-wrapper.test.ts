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
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  run: (mode: string, env?: Record<string, string>) => { status: number; stdout: string; stderr: string }
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
    run: (mode, env = {}) => {
      const result = spawnSync('sh', [WRAPPER, mode], {
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

test('persona files are seeded once and never overwritten, because the user owns them', () => {
  const h = host()
  h.run('gateway')

  const soul = join(h.config, 'workspace', 'SOUL.md')
  assert.equal(readFileSync(soul, 'utf8'), 'shipped persona\n')

  writeFileSync(soul, 'my own voice\n')
  h.run('gateway')
  assert.equal(readFileSync(soul, 'utf8'), 'my own voice\n', 'an edited persona survives a restart')
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

  assert.ok(
    !/anthropic:cli|auth:/.test(h.patched()),
    'and never written into the config, which is the shape that does not work',
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

test('the exec allowlist is seeded once and an edited one is kept', () => {
  const h = host()
  h.run('gateway')

  const approvals = join(h.config, 'exec-approvals.json')
  assert.ok(existsSync(approvals))

  writeFileSync(approvals, '{"version":1,"mine":true}\n')
  h.run('gateway')
  assert.match(readFileSync(approvals, 'utf8'), /"mine":true/)
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
