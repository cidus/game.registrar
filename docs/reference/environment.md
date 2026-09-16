# Environment variables

Every variable anything in this repository reads, grouped by what reads it.
Settings that live in a file rather than the environment are in
[Configuration](configuration.md); the services that consume the container ones
are in [Container](container.md).

`.env` is read by Compose and handed to the gamereg services wholesale, so a
variable from any of the first three groups can be set there. `remark42` is the
exception: it receives only the variables named in `compose.yml`
([ADR 0089](../decisions/0089-public-service-gets-named-variables.md)).

## The CLI

| Variable | Default | What it does |
|---|---|---|
| `GAMEREG_VAULT` | the current directory | The vault root. `--vault` wins over it. |
| `GAMEREG_SOURCE` | `cli` | Stamped on every event this invocation appends. Only `cli`, `chat`, `cron` and `import` are accepted; anything else exits 2, because the log cannot be rewritten. |
| `GAMEREG_NON_INTERACTIVE` | unset | Any value other than empty or `0` disables prompting, so ambiguity is returned instead of asked. |
| `CI` | unset | Same effect as the above. |
| `GAMEREG_LOCALE` | unset | Output language, read on **every** invocation. The order is `--locale`, then `locale` in the config, then this, then `LC_ALL`, `LANG`, then `en`. |
| `LC_ALL`, `LANG` | unset | The last locale fallbacks. `pt_BR.UTF-8` normalizes to `pt-BR`. |
| `IGDB_CLIENT_ID` | from `gamereg.secrets.json` | Provider credential. The environment wins per field. **Secret.** |
| `IGDB_CLIENT_SECRET` | from `gamereg.secrets.json` | The other half. **Secret.** |
| `TZ` | the system zone | Never read directly: with `timezone` unset in the config, the CLI uses the process zone, which Node derives from `TZ` or `/etc/localtime`. Compose bind-mounts the host's zone file instead of setting `TZ`. |

## Wrappers and loops

The check-in poll (`agent/checkin.sh`), vault maintenance
(`scripts/autobuild.sh`, `docker/loop.sh`), the site loop
(`docker/site-loop.sh`) and `scripts/vendor-quartz.sh`.

| Variable | Default | What it does |
|---|---|---|
| `GAMEREG_VAULT` | none in the scripts (`/vault` in the image) | Required: the wrappers exit 2 when it is empty. |
| `GAMEREG_CHECKIN_CHANNEL` | empty | When set, the wake is delivered with `--reply-channel`. |
| `GAMEREG_CHECKIN_TO` | empty | When set, adds `--reply-to`. Without both, a wake has no routing of its own. |
| `OPENCLAW_AGENT` | `main` | Which agent session the wake runs in, and the agent the cron job is registered for. |
| `GAMEREG_AUTOBUILD_INTERVAL` | `600` | Seconds between maintenance ticks. A failed tick is logged and the loop continues. |
| `GAMEREG_SITE_INTERVAL` | `300` | Seconds between site-loop polls of the vault's git HEAD. |
| `SITE_COMMENTS_UPSTREAM` | empty in code, `remark42:8080` in `.env.example` | When set, the generated `Caddyfile` proxies `/remark42/*` to it. |
| `GAMEREG_SITE_WORK` | `/cache/quartz-build` | Scratch build directory. The vault is never written. |
| `GAMEREG_SITE_OUTPUT` | `/site` | Where the built site, the `Caddyfile` and the `.built-from` stamp are written. |

`GAMEREG_BIN`, `OPENCLAW_BIN`, `GIT_BIN`, `NPM_BIN`, `NPX_BIN` and
`GAMEREG_AUTOBUILD_BIN` name the binaries those scripts call. They exist so the
wrapper tests can stub them; leave them alone in a deployment.

## The container entrypoint

Set in `.env`, read while the container boots. Which step reads what is in
[Container reference](container.md#boot-sequence).

| Variable | Default | What it does |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | none | Required in gateway mode; patched into the channel configuration every boot. **Secret.** |
| `TELEGRAM_ALLOW_FROM` | empty | Empty starts the gateway in pairing mode. A value must be all digits: an `@username` exits 2. |
| `CLAUDE_CODE_OAUTH_TOKEN` | empty | A Claude subscription token, installed into the gateway's auth store. **Secret.** |
| `OPENCLAW_AUTH_KEY` | empty | An API key, installed through `openclaw onboard`. **Secret.** |
| `OPENCLAW_AUTH_CHOICE` | `apiKey` | Which key kind `onboard` is told about; also infers the model when none is set. |
| `OPENCLAW_AUTH_EXPIRES_IN` | `365d` | Expiry passed with a pasted subscription token. |
| `OPENROUTER_API_KEY` | empty | Read by the gateway itself; also what the shipped hosted voice transcription uses. **Secret.** |
| `OPENCLAW_MODEL` | inferred from whichever credential exists | Patched as the agent's primary model on every boot. |
| `OPENCLAW_MODEL_FALLBACK` | empty | Exactly one fallback model; a comma-separated list is not split. |
| `OPENCLAW_GATEWAY_TOKEN` | generated into `/config/.gateway-token` | The gateway's access token. The file is the authority and is restated into the configuration every boot. **Secret.** |
| `OPENCLAW_GATEWAY_URL` | unset | When set, CLI clients in the container are pointed at it. |
| `GAMEREG_GIT_NAME` | `gamereg` | Commit identity for the vault, written every boot. |
| `GAMEREG_GIT_EMAIL` | `gamereg@localhost` | The other half. |
| `GAMEREG_SSH_KEY` | `/config/ssh/id_ed25519` | When the file exists, git pushes use it with strict host key checking. **Secret (the file).** |
| `GAMEREG_SSH_KNOWN_HOSTS` | `/config/ssh/known_hosts` | Used as the known-hosts file. Missing means pushes fail immediately. |
| `GAMEREG_CHECKIN_CRON` | `0 * * * *` | The check-in schedule, used **only** when the job is first registered. |
| `GAMEREG_CHECKIN_JOB` | `gamereg-checkin` | The job's name, and how registration decides it already exists. |
| `OPENCLAW_STATE_DIR` | `/config` | The gateway's state directory, from which the workspace path is derived. |
| `OPENCLAW_CONFIG_PATH` | `/config/openclaw.json` | Checked before the boot repairs a stale configuration. |
| `GAMEREG_AGENT_DEFAULTS` | `/opt/gamereg/agent-defaults` | Where the shipped skill, workspace files and example configurations live inside the image. |
| `HOME` | `/config` (`/cache` for `site-build`) | Where git and npm write. It is set in the image because a uid missing from `/etc/passwd` would otherwise get `/` ([ADR 0083](../decisions/0083-home-is-set-in-the-image.md)). |

### Vault seeding

Applied **only** when the vault has no `gamereg.config.json`. Changing them
afterwards does nothing; edit `gamereg.config.json` instead.

| Variable | Default | What it does |
|---|---|---|
| `GAMEREG_TIMEZONE` | unset (the system zone) | `gamereg init --timezone`. |
| `GAMEREG_LOCALE` | unset | `init --locale`. Note that the CLI also reads this variable on every later invocation. |
| `GAMEREG_DAY_CUTOFF` | `05:00` | `init --day-cutoff`. It must be `HH:MM`; `5:00` makes the boot fail. |
| `GAMEREG_TARGETS` | `obsidian` | `init --targets`, comma separated. |
| `GAMEREG_PLATFORMS` | empty | `init --platforms`, comma separated and canonicalized. |

## Compose

Read while Compose reads the file, not by anything inside a container.

| Variable | Default | What it does |
|---|---|---|
| `GAMEREG_IMAGE_TAG` | `edge` | Which published image tag the services run. |
| `PUID`, `PGID` | `1000` | The uid and gid the gamereg services run as. |
| `GAMEREG_VAULT_PATH` | `./vault` | Host path mounted at `/vault`. |
| `GAMEREG_CONFIG_PATH` | `./config` | Host path mounted at `/config`. |
| `GAMEREG_SSH_PATH` | `./config/ssh` | Deploy key directory, mounted read-only into maintenance. |
| `GAMEREG_SITE_PATH` | `./site` | Built site and its serving configuration. |
| `GAMEREG_SITE_CACHE_PATH` | `./cache` | Build tree and npm cache for the site profile. |
| `GATEWAY_START_PERIOD` | `300s` | Health check grace period. Raise it on a slow machine; do not shorten the interval. |
| `GATEWAY_MEM_LIMIT` | `1g` | Gateway memory limit, and a floor rather than a target. |
| `MAINTENANCE_MEM_LIMIT` | `256m` | Maintenance loop limit. |
| `SITE_BUILD_MEM_LIMIT` | `768m` | Site build limit; a Quartz build peaks at 400–700 MB. |
| `OPENCLAW_GATEWAY_PORT` | `18789` | The port the health check connects to. |
| `SITE_BIND` | `127.0.0.1` | Host address `site-serve` publishes on. Publishing on `0.0.0.0` should be a decision. |
| `SITE_PORT` | `8080` | Host port for `site-serve`. |

## Comments (Remark42)

Named one by one in `compose.yml`; several are renamed on the way in.

| Variable in `.env` | Reaches the container as | Default | What it does |
|---|---|---|---|
| `REMARK_URL` | `REMARK_URL` | empty | The public address a browser will use. It builds the OAuth callbacks and the links in feeds, so it takes one value. |
| `REMARK_SECRET` | `SECRET` | empty | Signs the tokens. **Secret.** |
| `REMARK_SITE` | `SITE` | `gamereg` | The Remark42 site id. |
| `REMARK_ADMIN_ID` | `ADMIN_SHARED_ID` | empty | Who is the admin. |
| `REMARK_TELEGRAM_TOKEN` | `TELEGRAM_TOKEN` | empty | A **second** bot's token, never the Registrar's. **Secret.** |
| `ALLOWED_HOSTS` | `ALLOWED_HOSTS` | `https://games.example.com` in the example | Which origins may embed the threads. The shipped value is a placeholder. |
| `AUTH_ANON` | `AUTH_ANON` | `false` in compose, `true` in the example | Anonymous comments. |
| `AUTH_TELEGRAM` | `AUTH_TELEGRAM` | `false` | Telegram sign-in. Booleans carry an explicit `false`: Remark42 reads presence as enable. |
| `AUTH_GITHUB_CID` / `_CSEC`, and the same pair for `GOOGLE`, `DISCORD`, `YANDEX`, `PATREON`, `MICROSOFT` | unchanged | empty | OAuth credentials. A provider works only when its variables are set **and** its line exists in `compose.yml`; a test asserts that every provider the example offers is wired. **Secret.** |

## Tunnel

| Variable in `.env` | Reaches the container as | Default | What it does |
|---|---|---|---|
| `CLOUDFLARE_TUNNEL_TOKEN` | `TUNNEL_TOKEN` | empty | Credential for `cloudflared`, passed through the environment and never on the command line, where it would be world-readable. **Secret.** |

## Build arguments

Not environment variables at runtime: `NODE_VERSION` (`24-bookworm-slim`) and
`OPENCLAW_VERSION` (`2026.9.4`) are `ARG`s in the
[Dockerfile](../../Dockerfile), pinned deliberately
([ADR 0092](../decisions/0092-openclaw-pinned-with-1g-floor.md)).
