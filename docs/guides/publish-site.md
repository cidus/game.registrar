# Publish the register as a website

Turn the vault into a public site with [Quartz](https://quartz.jzhao.xyz). gamereg
writes the site's *input*; building and hosting it is a separate step you choose.

## What gamereg gives you

The `quartz` build target plans its files from the event log, like every other
target. It writes:

| Path | Write policy |
|---|---|
| `quartz/content/games/<slug>.md` | replace |
| `quartz/content/runs/*.md` | replace |
| `quartz/content/index.md` — the consolidated table, and Quartz's landing page | replace |
| `quartz/content/stats.md` | replace |
| `quartz/content/reviews/<year>.md` | replace |
| `quartz/content/reviews/heatmap-<year>.svg` | replace |
| `quartz/content/Game Database.base` | seed |
| `quartz/quartz.config.yaml` | seed |

`replace` is regenerated in full on every build; `seed` is written once and never
overwritten, so the two configuration files above are yours after the first
build. See [docs/spec/07-targets.md](../spec/07-targets.md) for the write
policies and [src/targets/quartz.ts](../../src/targets/quartz.ts) for the plan.

**gamereg never runs Quartz.** The build spawns no subprocess and touches no
network, and Quartz does not need to be installed for `gamereg build` to work.
Why: [ADR 0029](../decisions/0029-quartz-plans-from-folded-state.md).

The site carries what the log knows — titles, metadata, covers, runs, sessions,
notes and verdicts. Prose typed by hand into an Obsidian game note lives outside
the `gamereg` markers, never reaches the folded state, and so never reaches the
site.

## Three ways to build the site

| Where | How | When to pick it |
|---|---|---|
| Off-box, from the vault's git repository | Cloudflare builds on push, or a CI job you write | The default. The maintenance loop already pushes the vault, so building elsewhere costs the register's machine nothing. Why: [ADR 0036](../decisions/0036-site-built-off-box-by-default.md) |
| By hand, wherever the vault is checked out | `npm install && npx quartz build` | A one-off publish, or previewing a change |
| The container's `site` profile | A build loop plus Caddy, on the same host | An installation that wants no external account. Why: [ADR 0076](../decisions/0076-site-profile-builds-in-the-gamereg-image.md) |

All three run the same Quartz build, so all three need the framework vendored
into the vault first — steps 1 and 2 below are common to every route.

## Before you start

- `quartz` is declared in the vault's `build.targets`. Naming a target the vault
  has not declared exits 2. See
  [configuration reference](../reference/configuration.md).
- You have decided whether cover art and photos are published —
  `images.publish`, default `false`. See
  [Publish or withhold images](#publish-or-withhold-images) below.
- `git`, `node`, `npm` and `npx` are available on whichever machine runs step 2.
  The vendor script runs on the host, not inside a container.
- A checkout of this repository, for `scripts/vendor-quartz.sh`. Nothing else in
  the container installation needs one.

## 1. Generate the content

```bash
gamereg build quartz
```

The argument narrows the build to one target; `gamereg build` with no argument
builds everything the vault declares. Either way `quartz/` now holds
`content/` and a seeded `quartz.config.yaml`, and nothing else — there is no
framework there yet, so there is nothing to build.

Check what was planned:

```bash
gamereg build --list
```

## 2. Vendor Quartz into the vault

[`scripts/vendor-quartz.sh`](../../scripts/vendor-quartz.sh) copies a Quartz
checkout's framework files into `<vault>/quartz/`, beside the content step 1
wrote.

```bash
export GAMEREG_VAULT=/path/to/vault
scripts/vendor-quartz.sh --clone --tag v5.0.0
```

`GAMEREG_VAULT` must be exported: the script has no fallback to the current
directory. It refuses to run until `<vault>/quartz/quartz.config.yaml` exists,
which is what step 1 produces.

| Flag | Effect |
|---|---|
| `--clone` | Fetch the upstream repository into a temporary directory (shallow) and vendor from that |
| `--tag <ref>` | Pin the clone to a ref. Only valid with `--clone`; without it, `--clone` tracks the default branch |
| `--source <path>` | Vendor from a checkout you already have. Mutually exclusive with `--clone` |
| `--dry-run` | Print the plan and touch nothing: no clone, no copy, no `npm`, no `npx` |

Exactly one of `--clone` and `--source` is required.

**What it copies** is an explicit allowlist: `quartz.ts`, `tsconfig.json`,
`globals.d.ts`, `index.d.ts`, `quartz.config.default.yaml`, `LICENSE.txt`, the
dotfiles Quartz ships (`.gitattributes`, `.gitignore`, `.node-version`,
`.npmrc`, `.prettierignore`, `.prettierrc`), and the framework's own `quartz/`
subdirectory, which is replaced wholesale so a file removed upstream does not
linger. The upstream project's `.github/`, `docs/`, `Dockerfile` and README are
never copied.

**What it never touches** is the vault's own `content/` and
`quartz.config.yaml`, and `quartz/styles/custom.scss`, which Quartz designates
for site-specific CSS — it is backed up and restored across the wholesale
replace, so a hand-written stylesheet survives a rerun. A customization made
anywhere else inside `quartz/` does not.

**`package.json` is merged, not overwritten.** The checkout's version is the
base, and any `dependencies` or `devDependencies` entry the vault already had
and the checkout lacks is added back — so a theme or plugin installed by hand
survives an update. `package-lock.json` is deleted and regenerated by
`npm install`, which is what resolves those extra entries.

The script then runs, in this order: `npm install`, `npx quartz build` to
verify, and finally seeds `wrangler.jsonc` if it is absent.

> [!WARNING]
> The `name` in the seeded `wrangler.jsonc` is a guess and must equal the name
> of the Worker you actually created. A manual `wrangler deploy` reads it and
> will target a Worker that does not exist. Why: [ADR 0087](../decisions/0087-seeded-guesses-say-so.md).

### Commit the vendored files

The vault's `.gitignore`, written by `gamereg init`, holds only
`gamereg.secrets.json`, and the maintenance loop stages only the paths the build
owns plus the log and the asset store. The vendored framework is none of those,
so it stays untracked — and the maintenance loop reads "the tree is dirty" as
its entire notion of there being work to do, so every tick would run a network
enrichment and a full build, forever.

```bash
cd "$GAMEREG_VAULT"
git add quartz
git status --short          # expect: nothing but what you meant to add
git commit -m "chore(vault): vendor Quartz"
```

The script copies Quartz's own `.gitignore` into `<vault>/quartz/`; check that it
covers `node_modules/` and `public/` before staging, so build products stay out
of the repository.

## 3. Build it

```bash
cd "$GAMEREG_VAULT/quartz"
npm install
npx quartz build
```

The site lands in `<vault>/quartz/public/`. Step 2 already ran this once to
verify the vendored tree; run it again after any `gamereg build` that changed
the content.

## 4a. Deploy off-box

Point the build at the repository the maintenance loop already pushes. The one
recipe the vendor script supports is Cloudflare Workers: the seeded
`wrangler.jsonc` declares `./public` as the assets directory, so a dashboard
build that runs `npx quartz build` in `quartz/` serves what step 3 produces.

Check `name` against the Worker before deploying by hand:

```bash
cd "$GAMEREG_VAULT/quartz"
npx wrangler deploy
```

A CI build from the vault repository works the same way — check out the vault,
`npm install`, `npx quartz build`, publish `public/`. **No workflow ships with
this repository**; writing one is up to you.

## 4b. Serve it from the container

The `site` profile is opt-in and off by default. It runs two services: a build
loop in the gamereg image, and Caddy serving what it produces. Why:
[ADR 0076](../decisions/0076-site-profile-builds-in-the-gamereg-image.md).

Requirements:

- Steps 1 to 3 have run against the same directory compose mounts as the vault
  (`GAMEREG_VAULT_PATH`). The build loop exits when `<vault>/quartz/package.json`
  or `<vault>/quartz/quartz.config.yaml` is missing, rather than half-building.
- The machine has room for a Quartz build alongside the gateway. See
  [the container guide](deploy-container.md) for sizing before turning this on.

```bash
docker compose --profile site up -d
```

`SITE_BIND` defaults to `127.0.0.1` and `SITE_PORT` to `8080`, so nothing is
published to the network. Look at the result over an SSH tunnel:

```bash
ssh -L 8080:127.0.0.1:8080 <host>
```

then open `http://127.0.0.1:8080`.

How often the loop rebuilds, what triggers it, and where it stages the build are
in the [container reference](../reference/container.md). If the profile does not
come up, see [troubleshooting](troubleshooting.md).

> [!NOTE]
> If the `comments` profile is not running on this machine, clear
> `SITE_COMMENTS_UPSTREAM` — `.env.example` ships it set. See
> [Comments](comments.md).

## Publish or withhold images

`images.publish` is `false` by default and affects only the `quartz` target. It
is rendered as well as obeyed. Why:
[ADR 0055](../decisions/0055-one-publish-switch-rendered.md).

| `images.publish` | Content tree | Notes |
|---|---|---|
| `false` | No `quartz/content/assets/` | Notes say a picture was withheld; run-note frontmatter omits `cover` |
| `true` | `assets/` is hardlinked into `quartz/content/assets` on each build that runs `quartz` | Notes embed the images |

The vault's own `obsidian/assets` mirror is unaffected either way: withholding
never degrades the local copy.

> [!WARNING]
> Turning `images.publish` off later does not unpublish anything. The mirror
> only ever adds and its files are outside the build manifest, so nothing
> deletes them. Remove them yourself:
> ```bash
> cd "$GAMEREG_VAULT"
> rm -rf quartz/content/assets
> git add -A quartz/content/assets
> git commit -m "chore(vault): unpublish assets"
> ```

> [!WARNING]
> With `images.keep_original` also on, the untouched originals are mirrored too,
> EXIF included. Only the normalized WebP is stripped. Keep
> `images.keep_original` off on a vault you publish — see
> [configuration reference](../reference/configuration.md) and
> [security](../explanation/security.md).

## Upgrade Quartz

Rerun the vendor script. It is written to be rerunnable: the framework is
replaced in place, your `package.json` additions and `custom.scss` survive, and
the lockfile is regenerated.

```bash
export GAMEREG_VAULT=/path/to/vault
scripts/vendor-quartz.sh --clone --tag <newer-tag>
cd "$GAMEREG_VAULT" && git add quartz && git commit -m "chore(vault): upgrade Quartz"
```

`quartz.config.yaml` is never rewritten by either gamereg or the vendor script,
so configuration you added — a theme, the comments plugin — carries across.

## Next steps

- [Add comments to the site](comments.md)
- [Build outputs](build-outputs.md) — every target, and what each one writes
- [Configuration reference](../reference/configuration.md) — `build.targets`,
  `images.publish`
- [Container reference](../reference/container.md) — the `site` profile's
  services and variables
- [The quartz target](../spec/07-targets.md) — normative specification
