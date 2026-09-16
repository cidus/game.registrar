# Running the Registrar in containers

One compose file, three services, three optional profiles. Nothing here needs a
clone: `compose.yml` and a `.env` are the whole installation.

This page is the procedure. It does not explain why each decision was taken —
`agent/README.md` is the deployment log and carries the incidents behind these
rules, and is the right page when something behaves in a way this one does not
cover.

## What the machine needs

| | |
|---|---|
| RAM | **1.5 GB**, plus swap. 1 GB works only with care — see below |
| Disk | ~2 GB for the image, plus the vault |
| CPU | anything; sustained work on a burstable instance throttles |
| Network | outbound only. No port is published and no firewall rule is needed |
| Arch | `linux/amd64` or `linux/arm64` |

The gateway idles at ~432 MB and a `gamereg` invocation adds 60–150 MB while it
runs. `GATEWAY_MEM_LIMIT` defaults to `1g` and that is a floor, not a target: at
`480m` the gateway restarts itself every ~73 seconds under its own
memory-pressure check, which looks like a healthy container because each boot
passes the health check before dying.

**Swap is required, not advisory.** Without it the OOM killer arrives
mid-conversation:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

Add it to `/etc/fstab` so it survives a reboot.

On a 1 GB instance the swap file stops being a safety net and becomes
load-bearing. Prefer 2 GB. Two consequences of the small end worth knowing:
local Whisper does not fit (the model alone is ~550 MB), so voice transcription
uses the hosted entry already in the shipped config; and serving the site from
the same machine is the wrong call — see *The site*.

## Install

```bash
curl -O https://raw.githubusercontent.com/cidus/game.registrar/main/compose.yml
curl -o .env https://raw.githubusercontent.com/cidus/game.registrar/main/.env.example

# fill in TELEGRAM_BOT_TOKEN, then:
echo "PUID=$(id -u)" >> .env && echo "PGID=$(id -g)" >> .env
mkdir -p vault config/ssh
docker compose up -d
```

`docker compose up -d` blocks on the gateway's health condition, and on a small
instance the first boot takes minutes — every `openclaw` call in the entrypoint
is a Node start. Poll `docker compose ps` rather than assuming it hung.

**You do not need to look up your chat id.** Leave `TELEGRAM_ALLOW_FROM` empty
and message the bot: it replies with your own numeric id, a one-time code and
the command that approves it. That is the only way to learn the id — no Telegram
client displays it and the Bot API will not resolve a username. Fill the
variable in instead if you already know it; the two are alternatives, not steps,
because an allowlist ignores the pairing store.

**Use a second bot if a deployment already exists.** Telegram long-polling does
not share: two gateways on one token fight over every update, and the symptom is
a Registrar that answers *sometimes*. Stop the old one, or ask @BotFather for a
throwaway.

The model is the one thing that will not announce itself as missing. Without a
credential the gateway starts, Telegram connects, and nothing ever answers. Set
one of `CLAUDE_CODE_OAUTH_TOKEN` (a Claude subscription — mint it with
`claude setup-token`), `OPENCLAW_AUTH_KEY` with `OPENCLAW_AUTH_CHOICE`, or
`OPENROUTER_API_KEY`.

## Which image

`compose.yml` pulls `ghcr.io/cidus/gamereg`, built by CI from every push to
`main` for `linux/amd64` and `linux/arm64`, both on native runners.

| tag | moves | for |
|---|---|---|
| `edge` | yes, with `main` | a preview installation, the default |
| `sha-<commit>` | never | pinning, and rolling back from a bad `edge` |

There is no `:latest`. It is the tag that reads as "safe to depend on" to
someone who was never told this is a preview, and that claim belongs to a
version number this has not published yet.

### Updating, pinning, rolling back

```bash
docker compose pull && docker compose up -d      # take the current edge
```

A running stack keeps the image it started with, and `:edge` moves — `up -d`
alone will not fetch a newer one.

```bash
echo "GAMEREG_IMAGE_TAG=sha-7ab6b0e" >> .env     # pin, or roll back
docker compose up -d
```

**After an image upgrade, send `/reset` in the chat.** A conversation already
under way keeps the copy of the skill it loaded at session start; restarting the
container does not change that, and the symptom is a Registrar behaving like the
previous version with no error anywhere.

Working from a checkout, build instead of pulling:

```bash
docker compose -f compose.yml -f compose.build.yml build
docker compose -f compose.yml -f compose.build.yml up -d
```

## What happens on every boot

The entrypoint is idempotent, so a first run, a restart and an image upgrade all
take the same path.

1. **Preflight.** Refuses on a missing token, an `@username` where a numeric id
   belongs, or a vault it cannot write. Warns on missing IGDB credentials —
   an unavailable provider is exit 6 and the local work still commits.
2. **Git.** `safe.directory` for the bind-mounted vault, and a commit identity.
3. **Vault.** `gamereg init` only when there is no `gamereg.config.json`, `git
   init` only when there is no `.git`. An existing vault is never touched. A new
   one is committed at creation, because `autobuild.sh` treats "is the tree
   dirty" as its entire state and never stages config files itself.
4. **Agent files.** Policy per file. The skill directory and `AGENTS.md` /
   `TOOLS.md` are **replaced** every boot — they are code, and a new image
   redeploys them; an edited card is kept under `backups/` first. `SOUL.md`,
   `IDENTITY.md`, `REACTIONS.md`, `USER.md` and `HEARTBEAT.md` are **yours**.
   The boot records the hash of what it seeded, so a file you never touched
   follows the image while one you edited is kept, with a `NOTICE` naming the
   shipped copy under `/opt/gamereg/agent-defaults/workspace/`.

   `USER.md` is where a rule of your own goes ("always answer in English"). It
   never overrides the *Safety* section of `AGENTS.md`.
5. **Model auth, then model choice.** Two separate steps: which credential
   exists, and which model answers (`OPENCLAW_MODEL`,
   `OPENCLAW_MODEL_FALLBACK`). A Claude subscription is installed into the
   per-agent auth store, not the environment — see the trap below.
6. **Gateway config.** The shipped example is seeded once; bot token, allowlist
   and approvers are patched from the environment every boot, so editing `.env`
   and restarting moves them.

The gateway generates its own access token on first boot and reuses it: in a
container OpenClaw binds to `0.0.0.0` rather than loopback and then correctly
refuses to start unauthenticated. It lands in `/config/.gateway-token`. Set
`OPENCLAW_GATEWAY_TOKEN` yourself if you would rather manage it.

The gateway then starts, and once healthy the one-shot `provision` service
registers the hourly check-in job — it cannot run earlier, because
`openclaw cron add` is a gateway *client* command.

A model that refuses is handed over, not waited on. OpenClaw 2026.9.4 retries
the same model before it will consider the fallback chain, and on a 429 it
sleeps for the provider's `Retry-After` — which Anthropic sets to however long
the limit has left, 41 to 260 minutes across five incidents here, against a turn
abandoned after about six. The chain was therefore unreachable, and every rate
limit reached the user as "this turn was interrupted because it stopped making
progress". The entrypoint writes `retry.provider.maxRetries: 0` into the agent's
`settings.json`; `OPENCLAW_PROVIDER_MAX_RETRIES` raises it, which is worth doing
only with no fallback configured, where waiting is all there is to do. It cannot
be set per provider, so `OPENCLAW_MODEL_FALLBACK` takes a comma-separated chain
instead — another entry does what a retry did, without waiting on the model that
just said no.

The nightly `memory-core` dreaming sweep is disabled here. It writes a narrative
diary into the workspace, which is the system prompt of every later turn, and
`tools.allow` gives the agent no tool that could read what it builds. Re-enable
with `plugins.entries.memory-core.config.dreaming.enabled`.

## Pushing the vault

`scripts/autobuild.sh` commits and pushes on every tick that finds a dirty tree.
Without a remote it commits and stops, which is a supported setup.

With one, put a deploy key at `config/ssh/id_ed25519` and a `known_hosts` beside
it; the entrypoint wires `GIT_SSH_COMMAND` when it finds the key. **Generate `known_hosts` before the first push**, or it blocks forever on a
fingerprint prompt nobody can answer:

```bash
ssh-keyscan github.com > config/ssh/known_hosts
```

The directory has to exist and hold the key before the stack starts. Pointed at
a missing path, Docker creates an empty root-owned directory and the push fails
with `Host key verification failed`, which names neither the key nor the mount.

## The site

**The default topology does not build the site here**, and on a small instance
that is the right answer: a Quartz build peaks at 400–700 MB and will take the
gateway with it, and a vault with a hundred covers is ~20 MB per full crawl
against 1 GB of monthly egress on the free tiers. The vault is already a git
repository the maintenance loop pushes, so build it from there — a GitHub
Action, or Cloudflare building on push. `scripts/vendor-quartz.sh` seeds a
`wrangler.jsonc` for exactly that.

The `site` profile exists for an installation that wants no external account:

```bash
scripts/vendor-quartz.sh --clone --tag v5.0.0   # once, on the host
docker compose --profile site up -d
```

`gamereg build quartz` writes Quartz's *input*; the framework is vendored
separately, because that clones a third-party repository and is a decision
rather than something a boot does on your behalf. The build container refuses to
start without it rather than half-working.

Measured with the gateway stopped: `npm install` 14s, the Quartz build 4s, about
two minutes from `up` to a served page. Running both at once leaves very little
free.

Three things to know about how it behaves:

- **It watches the vault's git HEAD, not the filesystem.** `gamereg build`
  rewrites derived artifacts wholesale, so mtimes say nothing; a commit means
  the maintenance loop found a real difference.
- **A failed build keeps the previous site** and does not advance the stamp, so
  the next tick retries. A stale page beats a blank one.
- **The build never writes to the vault.** `/vault` is mounted read-only and the
  Quartz tree is copied to a scratch directory first. `quartz plugin add` clones
  a repository and runs what it finds, and `npm install` runs the lifecycle
  scripts of a whole dependency tree — ordinary for a static site generator, and
  not something to point at an append-only event log. The copy replaces rather
  than overlays, so a page whose source disappears from the vault disappears
  from the site.

To look at the result without publishing a port, forward it:

```bash
ssh -L 8080:127.0.0.1:8080 <host>
```

`SITE_BIND` defaults to `127.0.0.1` because publishing on `0.0.0.0` should be a
decision, not a default.

## Comments

[Remark42](https://remark42.com) is a Go binary with an embedded BoltDB — no
database service, ~30 MB resident. It always runs *here*, because it is
stateful; what changes is how a browser reaches it.

| what you want | profiles | tunnel points at | `REMARK_URL` |
|---|---|---|---|
| nothing published | `site` `comments` | — | `http://127.0.0.1:8080/remark42` |
| site built elsewhere, comments here | `comments` `tunnel` | `remark42:8080` | `https://comments.example.com` |
| everything published from here | `site` `comments` `tunnel` | `site-serve:8080` | `https://example.com/remark42` |

What the tunnel points at is configured in Cloudflare's dashboard, not in
compose. The third row is worth noticing: pointing it at `site-serve` publishes
the site *and* the comments through one hostname, and since `site-serve` already
proxies `/remark42` they share an origin — no CORS, no second hostname.

**`REMARK_URL` takes one value.** It builds the OAuth callbacks and the links in
feeds, so it names whichever address a browser will really use. No configuration
makes a tunnel hostname and a localhost address both work.

**Both here.** Set `SITE_COMMENTS_UPSTREAM=remark42:8080` and Caddy serves the
comments under the site's own origin at `/remark42/`. `REMARK_URL` must carry
the same path.

**Reachable from outside.** `--profile tunnel` adds cloudflared: no published
port, no static address, no certificate to renew. Set
`CLOUDFLARE_TUNNEL_TOKEN` and point `REMARK_URL` at the tunnel's hostname.

`REMARK_SECRET` signs the JWTs — `openssl rand -hex 32`, and treat it as a
secret. `ALLOWED_HOSTS` names the origins allowed to embed the threads; left
empty Remark42 accepts any, so set it to the *site's* address, which with the
site built off-box is a different hostname from `REMARK_URL`.

### Who may comment

Auth providers are set in `.env` **and named in `compose.yml`** — both. Remark42
is the only service here a stranger can reach, so it deliberately has no
`env_file`: Compose loads the whole file, which would hand a public comment
engine the model credential, the bot token, the tunnel token and the IGDB keys.
Every variable it needs is listed explicitly, which is why that list is long.

Two shapes to respect when adding a provider. Names generic enough to collide in
a shared file are renamed (`REMARK_SECRET` → `SECRET`). And **boolean flags take
an explicit `false`, never an empty string** — Remark42 reads a variable's
*presence* as enable, so `AUTH_TELEGRAM=""` advertises a sign-in method that then
fails against the API.

Anonymous (`AUTH_ANON=true`) needs nothing. OAuth providers follow one shape,
`AUTH_GITHUB_CID` / `AUTH_GITHUB_CSEC` and so on, with the callback at
`<REMARK_URL>/auth/<provider>/callback`. A provider not already named in
`compose.yml` needs a line there too, or setting it does nothing and says
nothing.

**Telegram is the cheapest** — no OAuth app, no callback. But **it has to be its
own bot, not the Registrar's**: Telegram permits one consumer per token, so
sharing one makes the register answer *sometimes*. Ask @BotFather for a second
bot and set `REMARK_TELEGRAM_TOKEN`.

### Telling Quartz about it

The plugin is declared in the vault's own `quartz/quartz.config.yaml`. gamereg
seeds that file once and never rewrites it, so this is a one-time hand edit —
and it travels with the vault, so a site built off-box picks up the same
configuration.

```yaml
plugins:
  - source: "github:cidus/remark42.quartz"
    enabled: true
    options:
      host: "http://127.0.0.1:8080/remark42"
      site_id: "gamereg"
    layout:
      position: afterBody
      priority: 10
```

Two things that cost time otherwise. `source:` does **not** accept a bare npm
package name, even with the package installed — it takes a local path,
`github:owner/repo`, a full URL, or an object. And **`host` must equal
`REMARK_URL`**: a mismatch loads the widget from one address while Remark42
believes it lives at another, and nothing errors.

## Troubleshooting

**The agent answers like a generic assistant.** The persona and skill were not
found. Check `docker compose logs gateway` for the workspace path.

**It replies with `No API key found for provider "anthropic"`.** A Claude
subscription lives in the per-agent auth store, not the environment. Setting
`CLAUDE_CODE_OAUTH_TOKEN` and writing an `anthropic:cli` config profile is what
an already-onboarded host *looks* like and authenticates nothing. The entrypoint
installs it with `openclaw models auth paste-token` at boot; if this appears,
the token is missing or expired.

**The bot answers intermittently.** Two consumers of one token. Look for an old
host install: `systemctl --user disable openclaw-gateway.service` — stopping a
unit leaves it enabled, and the next reboot starts it alongside the container.

**The container is healthy but restarts every minute or so.** Memory. Each boot
passes the health check before dying. Raise `GATEWAY_MEM_LIMIT`, and add swap.

**The gateway never becomes healthy on a slow machine.** Raise
`GATEWAY_START_PERIOD`, never the check frequency.

**The stack runs the previous version after an upgrade.** `docker compose pull`
first — `up -d` alone keeps the image it has. Then `/reset` the conversation.

**The first push fails with `Host key verification failed`.** The SSH directory
was missing when the stack started, so Docker created an empty one. Populate it
and recreate the service.

**The site build fails on a missing dependency, repeatedly.** An interrupted
`npm install` leaves `node_modules` incomplete and reinstalling over it does not
repair it. The sentinel that guards this carries the lockfile's checksum;
delete `node_modules` in the vault's Quartz tree to force a clean install.

## What is deliberately not here

- **No `/var/run/docker.sock` mount.** The gateway runs a language model with
  shell access; that socket is root on the host.
- **No published ports** in the default topology. Nothing needs to reach in.
- **No secrets in the image.** Everything comes from `.env`, which is
  gitignored, or from files mounted read-only.
