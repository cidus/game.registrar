/**
 * `scripts/vendor-quartz.sh` driven end to end.
 *
 * Sibling of `test/autobuild-wrapper.test.ts`, with the network-risky pieces
 * — `npm install`, `npx quartz build` — stubbed instead of `git`: real
 * invocations would hit the npm registry and run a real Quartz build,
 * neither of which a test should do (CLAUDE.md's *Testing strategy*: no
 * network in unit tests, ever). The stubs are pure fakes, not exec-through
 * wrappers like the `git` stub elsewhere — they only log argv and exit with
 * a configurable code, so no `package-lock.json` or `node_modules` actually
 * gets written; assertions about `package.json` check the merge this script
 * performs, not anything npm itself would have produced.
 *
 * The fixture "source" is a minimal but recognizable Quartz checkout: just
 * enough of the allowlisted files to prove they're copied, plus a `content/`
 * and a `quartz.config.yaml` of its own and a `.github/workflows/` — the
 * things that must never reach the vault. The fixture "vault" starts with
 * its own `quartz/content/` and `quartz.config.yaml`, standing in for a
 * `gamereg build quartz` that already ran.
 *
 * `--clone` is exercised against a `git` stub too: a pure fake, not an
 * exec-through wrapper, that only recognizes `clone [opts] <url> <dest>` and
 * populates `<dest>` by copying a fixture "upstream" checkout (built the
 * same way as "source") — a real `git clone` against the network is exactly
 * what a unit test must not do.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { test } from 'node:test'

import { tempDir } from './helpers.ts'

const ROOT = join(import.meta.dirname, '..')
const WRAPPER = join(ROOT, 'scripts', 'vendor-quartz.sh')

type Host = {
  vault: string
  source: string
  upstream: string
  calls: (which: 'npm' | 'npx' | 'git') => string[]
  run: (...args: string[]) => { status: number; stdout: string; stderr: string }
}

function writeSource(source: string) {
  mkdirSync(source, { recursive: true })
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify(
      { name: '@jackyzha0/quartz', version: '5.0.0', dependencies: { '@quartz-themes/core': '^1.0.0' } },
      null,
      2,
    ),
  )
  writeFileSync(join(source, 'package-lock.json'), '{}\n')
  writeFileSync(join(source, 'tsconfig.json'), '{}\n')
  writeFileSync(join(source, 'quartz.ts'), '// entry\n')
  writeFileSync(join(source, 'globals.d.ts'), '')
  writeFileSync(join(source, 'index.d.ts'), '')
  writeFileSync(join(source, 'quartz.config.default.yaml'), 'default: true\n')
  writeFileSync(join(source, '.gitignore'), 'node_modules\n')
  mkdirSync(join(source, 'quartz'), { recursive: true })
  writeFileSync(join(source, 'quartz', 'build.ts'), '// framework source\n')
  mkdirSync(join(source, 'quartz', 'styles'), { recursive: true })
  writeFileSync(join(source, 'quartz', 'styles', 'custom.scss'), "// checkout's default custom.scss\n")

  // Must never reach the vault.
  mkdirSync(join(source, 'content'), { recursive: true })
  writeFileSync(join(source, 'content', 'index.md'), 'source content -- must never reach the vault\n')
  writeFileSync(join(source, 'quartz.config.yaml'), "source: own config -- must never overwrite the vault's\n")
  mkdirSync(join(source, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(source, '.github', 'workflows', 'ci.yml'), 'name: upstream CI\n')
}

function host(
  options: { failBin?: 'npm' | 'npx' | 'git'; failCode?: number; seedVault?: boolean } = {},
): Host {
  const dir = tempDir('gamereg-vendor-quartz-')
  const vault = join(dir, 'vault')
  const source = join(dir, 'source')
  const upstream = join(dir, 'upstream')
  const bin = join(dir, 'bin')
  const npmLog = join(dir, 'npm-calls.log')
  const npxLog = join(dir, 'npx-calls.log')
  const gitLog = join(dir, 'git-calls.log')
  mkdirSync(vault, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeSource(source)
  writeSource(upstream)

  if (options.seedVault !== false) {
    mkdirSync(join(vault, 'quartz', 'content'), { recursive: true })
    writeFileSync(join(vault, 'quartz', 'content', 'sifu.md'), '# Sifu\n')
    writeFileSync(join(vault, 'quartz', 'quartz.config.yaml'), 'theme: geocities-98\n')
  }

  const makeStub = (name: 'npm' | 'npx', log: string) => {
    const path = join(bin, name)
    writeFileSync(
      path,
      [
        '#!/bin/sh',
        `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
        options.failBin === name ? `exit ${options.failCode ?? 1}` : 'exit 0',
      ].join('\n') + '\n',
    )
    chmodSync(path, 0o755)
    return path
  }
  const npm = makeStub('npm', npmLog)
  const npx = makeStub('npx', npxLog)

  const git = join(bin, 'git')
  writeFileSync(
    git,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> ${JSON.stringify(gitLog)}`,
      options.failBin === 'git' ? `exit ${options.failCode ?? 1}` : '',
      // `clone [opts...] <url> <dest>` -- <dest> is always the last arg.
      `if [ "$1" = clone ]; then eval "dest=\\$$#"; mkdir -p "$dest"; cp -r ${JSON.stringify(upstream + '/.')} "$dest"; fi`,
      'exit 0',
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  )
  chmodSync(git, 0o755)

  return {
    vault,
    source,
    upstream,
    calls: (which) => {
      const log = which === 'npm' ? npmLog : which === 'npx' ? npxLog : gitLog
      try {
        return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
    run: (...args: string[]) => {
      const result = spawnSync('sh', [WRAPPER, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GAMEREG_VAULT: vault, NPM_BIN: npm, NPX_BIN: npx, GIT_BIN: git, NO_COLOR: '1' },
      })
      return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
  }
}

test('one of --source or --clone is required', () => {
  const gateway = host()
  const run = gateway.run()
  assert.equal(run.status, 2)
  assert.match(run.stderr, /one of --source <path> or --clone is required/)
})

test('--source and --clone are mutually exclusive', () => {
  const gateway = host()
  const run = gateway.run('--source', gateway.source, '--clone')
  assert.equal(run.status, 2)
  assert.match(run.stderr, /mutually exclusive/)
})

test('--tag without --clone is refused', () => {
  const gateway = host()
  const run = gateway.run('--source', gateway.source, '--tag', 'v5.0.0')
  assert.equal(run.status, 2)
  assert.match(run.stderr, /--tag only makes sense with --clone/)
})

test('GAMEREG_VAULT unset is a misconfiguration, not a guess', () => {
  const dir = tempDir('gamereg-vendor-quartz-novault-')
  const source = join(dir, 'source')
  writeSource(source)
  const result = spawnSync('sh', [WRAPPER, '--source', source], {
    encoding: 'utf8',
    env: { ...process.env, GAMEREG_VAULT: '' },
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr ?? '', /GAMEREG_VAULT/)
})

test('a --source that is not a Quartz checkout is refused', () => {
  const gateway = host()
  const dir = tempDir('gamereg-vendor-quartz-bogus-')
  const run = gateway.run('--source', dir)
  assert.equal(run.status, 2)
  assert.match(run.stderr, /does not look like a Quartz checkout/)
})

test('a vault with no seeded quartz.config.yaml is refused, and nothing is copied', () => {
  const gateway = host({ seedVault: false })
  const run = gateway.run('--source', gateway.source)
  assert.equal(run.status, 2)
  assert.match(run.stderr, /run 'gamereg build quartz' in the vault first/)
  assert.equal(existsSync(join(gateway.vault, 'quartz', 'package.json')), false)
})

test('vendors the allowlist, and never the excluded set', () => {
  const gateway = host()
  const run = gateway.run('--source', gateway.source)
  assert.equal(run.status, 0, run.stderr)

  for (const f of [
    'package.json',
    'tsconfig.json',
    'quartz.ts',
    'globals.d.ts',
    'index.d.ts',
    'quartz.config.default.yaml',
    '.gitignore',
    join('quartz', 'build.ts'),
  ]) {
    assert.equal(existsSync(join(gateway.vault, 'quartz', f)), true, `expected ${f} to be vendored`)
  }

  // The vault's own content and config survive, byte for byte.
  assert.equal(readFileSync(join(gateway.vault, 'quartz', 'quartz.config.yaml'), 'utf8'), 'theme: geocities-98\n')
  assert.equal(readFileSync(join(gateway.vault, 'quartz', 'content', 'sifu.md'), 'utf8'), '# Sifu\n')

  // The source's own content and config never leaked in.
  assert.equal(existsSync(join(gateway.vault, 'quartz', 'content', 'index.md')), false)
  assert.equal(existsSync(join(gateway.vault, 'quartz', '.github')), false)

  // package.json carries --source's dependencies; package-lock.json is never
  // copied verbatim -- it's `npm install`'s job to produce one, and the npm
  // stub here is a pure fake that writes nothing.
  const pkg = JSON.parse(readFileSync(join(gateway.vault, 'quartz', 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies['@quartz-themes/core'], '^1.0.0')
  assert.equal(existsSync(join(gateway.vault, 'quartz', 'package-lock.json')), false)
})

test('a destination-only dependency (a theme installed by hand) survives an update', () => {
  // This is the exact failure this script had against a live vault: a
  // quartz.config.yaml already selecting a theme --source's package.json
  // never declared, fixed once with `npm install <theme>` run inside the
  // vault, and wiped out by the next update overwriting package.json
  // verbatim from --source.
  const gateway = host()
  const first = gateway.run('--source', gateway.source)
  assert.equal(first.status, 0, first.stderr)

  const pkgPath = join(gateway.vault, 'quartz', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.dependencies['@quartz-themes/geocities-98'] = '^1.0.1'
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

  // --source still knows nothing about the theme.
  const second = gateway.run('--source', gateway.source)
  assert.equal(second.status, 0, second.stderr)

  const merged = JSON.parse(readFileSync(pkgPath, 'utf8'))
  assert.equal(merged.dependencies['@quartz-themes/geocities-98'], '^1.0.1')
  // --source's own dependency is still there too -- this is a merge, not a
  // refusal to update.
  assert.equal(merged.dependencies['@quartz-themes/core'], '^1.0.0')
})

test('a hand-edited quartz/styles/custom.scss survives an update, unlike the rest of quartz/', () => {
  // This is the second live-vault failure this script had: quartz/ is
  // replaced wholesale, and custom.scss -- Quartz's own documented
  // customization point, not framework code -- was going out with it.
  const gateway = host()
  const first = gateway.run('--source', gateway.source)
  assert.equal(first.status, 0, first.stderr)

  const customScssPath = join(gateway.vault, 'quartz', 'quartz', 'styles', 'custom.scss')
  assert.equal(readFileSync(customScssPath, 'utf8'), "// checkout's default custom.scss\n")
  writeFileSync(customScssPath, '.my-theme { color: hotpink; }\n')

  // Meanwhile upstream also changed a file the user never touched.
  writeFileSync(join(gateway.source, 'quartz', 'build.ts'), '// framework source, updated\n')

  const second = gateway.run('--source', gateway.source)
  assert.equal(second.status, 0, second.stderr)

  // The hand edit survived...
  assert.equal(readFileSync(customScssPath, 'utf8'), '.my-theme { color: hotpink; }\n')
  // ...and an untouched file still updated normally.
  assert.equal(
    readFileSync(join(gateway.vault, 'quartz', 'quartz', 'build.ts'), 'utf8'),
    '// framework source, updated\n',
  )
})

test('npm install failure is fatal, and quartz build is never attempted', () => {
  const gateway = host({ failBin: 'npm', failCode: 1 })
  const run = gateway.run('--source', gateway.source)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /npm install failed/)
  assert.deepEqual(gateway.calls('npx'), [])
})

test('a quartz build failure is fatal and surfaces', () => {
  const gateway = host({ failBin: 'npx', failCode: 1 })
  const run = gateway.run('--source', gateway.source)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /quartz build failed/)
})

test('wrangler.jsonc is seeded once and never overwritten', () => {
  const gateway = host()
  const first = gateway.run('--source', gateway.source)
  assert.equal(first.status, 0, first.stderr)

  const wranglerPath = join(gateway.vault, 'quartz', 'wrangler.jsonc')
  assert.equal(existsSync(wranglerPath), true)

  const seeded = readFileSync(wranglerPath, 'utf8')
  assert.match(seeded, /"directory": "\.\/public"/)

  // The name is the vault's own, with nothing appended. An earlier version
  // added "-site", which produced a name no Worker had -- wrong from the first
  // write and never noticed, because Cloudflare's dashboard builds know which
  // Worker they are building and only warn. A manual `wrangler deploy` does
  // not, and would target a Worker that does not exist.
  assert.match(seeded, new RegExp(`"name": "${basename(gateway.vault)}"`))
  assert.ok(!/-site"/.test(seeded), 'no invented suffix')
  assert.match(seeded, /GUESS/, 'and it says that it is a guess')

  // Simulate a hand edit, then run again -- the edit must survive.
  writeFileSync(wranglerPath, '{ "name": "hand-edited" }\n')
  const second = gateway.run('--source', gateway.source)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(readFileSync(wranglerPath, 'utf8'), '{ "name": "hand-edited" }\n')
})

test('rerunning updates the framework wholesale, but still preserves content and config', () => {
  const gateway = host()
  const first = gateway.run('--source', gateway.source)
  assert.equal(first.status, 0, first.stderr)
  assert.equal(existsSync(join(gateway.vault, 'quartz', 'quartz', 'build.ts')), true)

  // Upstream renamed a framework file between versions.
  rmSync(join(gateway.source, 'quartz', 'build.ts'))
  writeFileSync(join(gateway.source, 'quartz', 'build2.ts'), '// renamed\n')

  const second = gateway.run('--source', gateway.source)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(existsSync(join(gateway.vault, 'quartz', 'quartz', 'build.ts')), false, 'removed file should not linger')
  assert.equal(existsSync(join(gateway.vault, 'quartz', 'quartz', 'build2.ts')), true)

  // Content and config are still exactly what they were.
  assert.equal(readFileSync(join(gateway.vault, 'quartz', 'quartz.config.yaml'), 'utf8'), 'theme: geocities-98\n')
  assert.equal(readFileSync(join(gateway.vault, 'quartz', 'content', 'sifu.md'), 'utf8'), '# Sifu\n')
})

test('--dry-run describes the plan and touches nothing', () => {
  const gateway = host()
  const run = gateway.run('--dry-run', '--source', gateway.source)
  assert.equal(run.status, 0)
  assert.match(run.stderr, /would vendor from/)
  assert.equal(existsSync(join(gateway.vault, 'quartz', 'package.json')), false)
  assert.deepEqual(gateway.calls('npm'), [])
  assert.deepEqual(gateway.calls('npx'), [])
})

test('--clone fetches upstream and vendors from it, same as --source', () => {
  const gateway = host()
  const run = gateway.run('--clone')
  assert.equal(run.status, 0, run.stderr)

  const call = gateway.calls('git')[0]!
  assert.match(call, /^clone --depth 1 https:\/\/github\.com\/jackyzha0\/quartz /)
  assert.doesNotMatch(call, /--branch/)

  assert.equal(existsSync(join(gateway.vault, 'quartz', 'package.json')), true)
  assert.equal(existsSync(join(gateway.vault, 'quartz', 'quartz', 'build.ts')), true)
  // The vault's own content and config are exactly as untouched as with --source.
  assert.equal(readFileSync(join(gateway.vault, 'quartz', 'quartz.config.yaml'), 'utf8'), 'theme: geocities-98\n')
})

test('--clone --tag pins the clone to that ref', () => {
  const gateway = host()
  const run = gateway.run('--clone', '--tag', 'v5.0.0')
  assert.equal(run.status, 0, run.stderr)

  const call = gateway.calls('git')[0]!
  assert.match(call, /^clone --depth 1 --branch v5\.0\.0 https:\/\/github\.com\/jackyzha0\/quartz /)
})

test('a failed --clone is fatal, and nothing downstream runs', () => {
  const gateway = host({ failBin: 'git', failCode: 1 })
  const run = gateway.run('--clone')
  assert.equal(run.status, 1)
  assert.match(run.stderr, /git clone failed/)
  assert.deepEqual(gateway.calls('npm'), [])
})

test('--dry-run with --clone describes the plan without cloning', () => {
  const gateway = host()
  const run = gateway.run('--dry-run', '--clone', '--tag', 'v5.0.0')
  assert.equal(run.status, 0)
  assert.match(run.stderr, /would clone .*jackyzha0\/quartz @ v5\.0\.0/)
  assert.deepEqual(gateway.calls('git'), [])
  assert.deepEqual(gateway.calls('npm'), [])
})
