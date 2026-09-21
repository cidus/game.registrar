# Container reference

What the Compose stack contains: services, profiles, mounts, the boot sequence
and the files each boot writes. For the installation procedure see
[Deploy with containers](../guides/deploy-container.md); for the variables in
`.env` see [Environment](environment.md).

The authorities are [`compose.yml`](../../compose.yml),
[`Dockerfile`](../../Dockerfile) and
[`docker/entrypoint.sh`](../../docker/entrypoint.sh). This page describes what
they do today.

## Machine requirements

| | |
|---|---|
| RAM | 1.5 GB recommended. 1 GB works only with care |
| Swap | required, 2 GB |
| Disk | ~2 GB for the image, plus the vault |
| CPU | any; sustained work on a burstable instance throttles |
| Network | outbound only. No port is published by default |
| Architecture | `linux/amd64` or `linux/arm64` |

The gateway idles at roughly 432 MB and `GATEWAY_MEM_LIMIT` defaults to `1g`,
which is a floor rather than a target: at `480m` the gateway restarts itself
every minute or so under its own memory-pressure check, and each boot passes
the health check before dying. See
[ADR 0092](../decisions/0092-openclaw-pinned-with-1g-floor.md) for the
measurements.

## Image

| | |
|---|---|
| Registry | `ghcr.io/cidus/gamereg` |
| Tags | `edge` (moves with `main`), `sha-<commit>` (immutable). No `:latest` |
| Platforms | `linux/amd64`, `linux/arm64`, built on native runners |
| Selected by | `GAMEREG_IMAGE_TAG` |

[`.github/workflows/image.yml`](../../.github/workflows/image.yml) publishes
only from `main`, and only after a verify job that builds the image, runs
`gamereg --version` and `gamereg-entrypoint gateway --dry-run`, and rebuilds
`example-vault/` inside the image to diff it against the committed golden
files. Why there is no `:latest`:
[ADR 0099](../decisions/0099-image-tags-edge-and-sha-only.md).

[`compose.build.yml`](../../compose.build.yml) replaces the published image
with a local build, for work from a checkout. The builder stage copies the
checkout in, so `.dockerignore` excludes `.env` and its variants: a filled
`.env` never reaches a builder layer or the build cache.

## Services

| Service | Profile | Image | Role | Memory |
|---|---|---|---|---|
| `gateway` | default | gamereg | Runs the OpenClaw gateway: receives messages, holds the compiled prompt and the open sessions, executes `gamereg` | `GATEWAY_MEM_LIMIT` (`1g`) |
| `provision` | default | gamereg | One shot after the gateway is healthy: registers the check-in job, then exits | — |
| `maintenance` | default | gamereg | Loop: enrich, build, commit and push the vault when its tree is dirty | `MAINTENANCE_MEM_LIMIT` (`256m`) |
| `site-build` | `site` | gamereg | Loop: rebuilds the Quartz site when the vault's git HEAD moves | `SITE_BUILD_MEM_LIMIT` (`768m`) |
| `site-serve` | `site` | `caddy:2-alpine` | Serves the built site, and optionally proxies the comments | 64m |
| `remark42` | `comments` | `ghcr.io/umputun/remark42:latest` | Comment engine with an embedded database | 96m |
| `tunnel` | `tunnel` | `cloudflare/cloudflared:latest` | Outbound tunnel, so something outside can reach in | 64m |

Ordering and health:

- `gateway` is healthy when a TCP connect to `OPENCLAW_GATEWAY_PORT` (default
  `18789`) succeeds: `interval 30s`, `timeout 10s`, `retries 10`,
  `start_period` from `GATEWAY_START_PERIOD` (default `300s`). The check spawns
  no process, for the reason in
  [ADR 0082](../decisions/0082-health-check-is-a-tcp-connect.md).
- `provision` and `maintenance` wait for that health condition. `provision`
  also uses `network_mode: "service:gateway"`, so `127.0.0.1` reaches the
  gateway: OpenClaw refuses plaintext `ws://` to a non-loopback address
  ([ADR 0073](../decisions/0073-provision-service-registers-checkin.md)).
- `site-serve` waits for `site-build` to be healthy, which means
  `/site/Caddyfile` exists. Caddy exits when its configuration file is absent,
  so starting them together would crash-loop through the first build.
- `remark42` has no `env_file`: every variable it receives is named in
  `compose.yml`
  ([ADR 0089](../decisions/0089-public-service-gets-named-variables.md)).

## Profiles

| Profile | Command | Adds |
|---|---|---|
| — | `docker compose up -d` | `gateway`, `provision`, `maintenance` |
| `site` | `docker compose --profile site up -d` | `site-build`, `site-serve` |
| `comments` | `--profile comments` | `remark42` |
| `tunnel` | `--profile tunnel` | `tunnel` |

Profiles compose, and they are independent questions: what runs here, and what
may reach in ([ADR 0085](../decisions/0085-profiles-are-independent-and-opt-in.md)).
`compose.yml` uses no `${VAR:?}` interpolation, because Compose interpolates
the whole file before it filters by profile
([ADR 0074](../decisions/0074-no-required-variables-in-compose.md)).

## Mounts

| Host path (variable) | Container path | Services | Mode |
|---|---|---|---|
| `GAMEREG_VAULT_PATH` (`./vault`) | `/vault` | gateway, provision, maintenance | read-write |
| `GAMEREG_VAULT_PATH` | `/vault` | site-build | **read-only** |
| `GAMEREG_CONFIG_PATH` (`./config`) | `/config` | gateway, provision, maintenance | read-write |
| `GAMEREG_SSH_PATH` (`./config/ssh`) | `/config/ssh` | maintenance | read-only |
| `GAMEREG_SITE_PATH` (`./site`) | `/site` | site-build (rw), site-serve (ro) | |
| `GAMEREG_SITE_CACHE_PATH` (`./cache`) | `/cache` | site-build | read-write |
| `/etc/localtime` | `/etc/localtime` | gateway, maintenance | read-only |
| named volume `remark42` | `/srv/var` | remark42 | read-write |

Every service except `remark42` runs as `PUID:PGID`, so the vault is not left
owned by a stranger. Nothing is mounted from the directory holding
`compose.yml`, and scripts live in the image instead
([ADR 0084](../decisions/0084-nothing-mounted-from-project-dir.md)). The image
sets `HOME=/config` ([ADR 0083](../decisions/0083-home-is-set-in-the-image.md));
`site-build` overrides it to `/cache`, which is where its npm cache lives.

## Boot sequence

`gamereg-entrypoint gateway` runs these in order. Every step is idempotent, so
a first run, a restart and an image upgrade take the same path. `--dry-run`
performs the checks and stops before starting the gateway.

1. **Preflight.** Refuses to start on a missing bot token, an `@username` where
   a numeric id belongs, or a vault it cannot write. A missing IGDB credential
   is a warning.
2. **Repair a stale config.** `openclaw doctor --fix`, before anything reads
   the configuration, so a key an upgrade stopped recognising cannot block the
   boot.
3. **Git identity.** `safe.directory` for the bind-mounted vault, plus
   `GAMEREG_GIT_NAME` and `GAMEREG_GIT_EMAIL`.
4. **Seed the vault.** Only when there is no `gamereg.config.json`: `gamereg
   init` with the `GAMEREG_*` seeding values. Independently, a vault with no
   `.git` becomes a repository with a first commit — including one mounted with
   a config already in place. An existing vault's contents are never touched
   ([ADR 0075](../decisions/0075-seeded-vault-is-committed.md) explains why the
   first commit matters).
5. **Gateway token.** Uses `OPENCLAW_GATEWAY_TOKEN` when set, otherwise
   generates one into `/config/.gateway-token` and reuses it. In a container
   the gateway binds `0.0.0.0` and refuses to start unauthenticated.
6. **Model credential.** Installs one of `CLAUDE_CODE_OAUTH_TOKEN`,
   `OPENCLAW_AUTH_KEY` or `OPENROUTER_API_KEY` into the gateway's own auth
   store. The boot records a hash of the token it installed (never the token
   itself) and installs again whenever that hash changes, so a fresh token in
   `.env` takes effect on the next restart
   ([ADR 0081](../decisions/0081-credentials-in-the-auth-store.md)).
7. **Model choice.** `OPENCLAW_MODEL` and `OPENCLAW_MODEL_FALLBACK` (a
   comma-separated chain), separate from which credential exists. The boot also
   writes `retry.provider.maxRetries` into the agent's `settings.json` from
   `OPENCLAW_PROVIDER_MAX_RETRIES` (default `0`), so a model that refuses hands
   over to the chain instead of being waited on
   ([ADR 0100](../decisions/0100-refused-model-hands-over-to-the-fallback-chain.md)).
8. **Agent files.** See the table below.
9. **Gateway configuration.** Seeds the shipped example once (recorded by
   `/config/.gamereg-config-seeded`), then applies an overlay on every boot:
   `gateway.mode: "local"`, the auth token from `/config/.gateway-token`,
   `agents.defaults.workspace` under `/config`, `memory-core`'s nightly
   dreaming sweep disabled, and the Telegram channel's bot token, `dmPolicy`,
   sender list and approvers from the environment. Editing `.env` and
   restarting moves all of them; re-enabling dreaming in the config does not
   survive a restart
   ([ADR 0098](../decisions/0098-dreaming-disabled.md)).

Then `openclaw gateway run` takes over the process.

Other modes: `provision` repairs the config, resolves the token and registers
the check-in job; `maintenance` sets the git identity and runs the maintenance
loop; `site` runs the site loop. Any other argument is executed as a command,
which is how `docker compose run --rm gateway gamereg …` works.

## Agent files

`skills/gamereg` is deleted and copied fresh on every boot. Each
`workspace/*.md` follows a policy of its own
([ADR 0095](../decisions/0095-workspace-policy-per-file.md)):

| File | Policy |
|---|---|
| `AGENTS.md`, `TOOLS.md` | Replaced every boot. They are code: their contents are asserted against the real binary and the SQL schema in CI |
| `SOUL.md`, `IDENTITY.md`, `REACTIONS.md`, `USER.md`, `HEARTBEAT.md` | Seeded once, then yours |

A replaced file that had been edited is copied under `backups/` first. A seeded
file records the hash of what was written, so a later boot can tell an edit
from a shipped default that moved: untouched, it follows the image; edited, it
is kept and the boot logs a `NOTICE` naming the shipped copy under
`/opt/gamereg/agent-defaults/workspace/`
([ADR 0096](../decisions/0096-seeded-files-tracked-by-hash.md)). An install
from before this tracking is left alone. Any `DREAMS.md` is moved out of the
workspace.

## The check-in job

`provision` registers it only when no job of that name exists:

| | |
|---|---|
| Name | `GAMEREG_CHECKIN_JOB` (default `gamereg-checkin`) |
| Schedule | `GAMEREG_CHECKIN_CRON` (default `0 * * * *`), with `--exact` |
| Delivery | `--no-deliver`; the wrapper's stdout is never sent to a chat |
| Agent | `OPENCLAW_AGENT` (default `main`) |
| Command | `/usr/local/bin/gamereg-checkin`, with `GAMEREG_VAULT`, and `GAMEREG_CHECKIN_CHANNEL` / `GAMEREG_CHECKIN_TO` when set |

Because registration is skipped when the job exists, changing those variables
and restarting has no effect until the job is deleted with `openclaw cron rm`.
What the wrapper does, and why it files the check-in after the wake, is in
[ADR 0031](../decisions/0031-wrapper-files-checkin-after-wake.md).

## The maintenance loop

`docker/loop.sh` runs `gamereg-autobuild` every `GAMEREG_AUTOBUILD_INTERVAL`
seconds (default 600) and logs a failed tick without stopping. The script polls
`git status` in the vault and, when the tree is dirty, runs `gamereg enrich
--missing --covers`, then `gamereg build`, then commits and pushes. Without a
remote it commits and stops. It keeps no state beyond the repository
([ADR 0062](../decisions/0062-maintenance-is-an-external-script.md)).

## The site loop

`docker/site-loop.sh` refuses to start unless `<vault>/quartz/quartz.config.yaml`
exists (run `gamereg build quartz`) and `<vault>/quartz/package.json` exists
(vendor Quartz first — see [Publish a site](../guides/publish-site.md)).

Then, every `GAMEREG_SITE_INTERVAL` seconds (default 300):

- It watches the vault's **git HEAD**, not file timestamps: `gamereg build`
  rewrites derived artifacts wholesale, so timestamps say nothing.
- It stages the Quartz tree into `/cache/quartz-build` and builds there. The
  vault is mounted read-only, because a Quartz build runs third-party plugin
  code.
- `npm install` is guarded by a sentinel written after a successful install and
  carrying the lockfile's checksum, so an interrupted install is not mistaken
  for a complete one.
- A failed build leaves the previous site in place and does not advance the
  `/site/.built-from` stamp, so the next tick retries.
- It writes `/site/Caddyfile`, with `try_files {path}.html {path}/index.html
  {path}` — Quartz emits `stats.html` and links to `/stats`, and also emits
  both `tags/<tag>.html` and a `tags/<tag>/` directory — and, when
  `SITE_COMMENTS_UPSTREAM` is set, a `/remark42/*` reverse proxy.

See [ADR 0076](../decisions/0076-site-profile-builds-in-the-gamereg-image.md).

## Deliberately absent

- **No `/var/run/docker.sock`.** The gateway runs a language model with shell
  access, and that socket is root on the host. It is also why the site loop
  watches git HEAD instead of being triggered.
- **No published ports** in the default profile set. `site-serve` publishes one
  only under the `site` profile, bound to `SITE_BIND` (`127.0.0.1` by default).
- **No secrets in the image.** They come from `.env` or from read-only mounts.

More in [Security](../explanation/security.md).
