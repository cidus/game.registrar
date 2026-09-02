# Running the Registrar in containers

One compose file, three services, two optional profiles. This is the path for a
machine you do not want to hand-configure — `agent/README.md` remains the
record of what each step *means*, and is worth reading when something here
behaves in a way this page does not explain.

## What it assumes about the machine

Sized for the smallest host anyone actually uses: a GCP always-free
`e2-micro`. Two of its numbers decide the architecture, and both are easy to
discover the expensive way.

**1 GB of RAM.** The gateway holds 250–400 MB resident. A `gamereg` invocation
is another 60–150 MB while it runs. That is most of the machine before anything
else starts, which is why the site profile is off by default: a Quartz build
peaks at 400–700 MB and will take the gateway with it. **A swap file is not
advice here.** Without one the OOM killer arrives mid-conversation:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

Add it to `/etc/fstab` so it survives a reboot.

**1 GB of egress a month.** A vault with a hundred covers is ~20 MB per full
crawl, and bots crawl. Serving the site from this machine is the wrong call
independently of the memory, which is why the default topology builds and
serves it somewhere else — see *The site* below.

**0.25 vCPU of baseline, bursting to 2.** Sustained work throttles hard once
the burst credit is gone. `npm install` and a site build are exactly the shape
that drains it.

Two consequences worth stating plainly: **local Whisper is not an option on
this machine** (the model alone is ~550 MB), so voice transcription uses the
hosted entry already active in `agent/openclaw.example.json5`; and Telegram is
long-polled, so **no port is published and no firewall rule is needed.**

## First run

```bash
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOW_FROM, then:
echo "PUID=$(id -u)" >> .env && echo "PGID=$(id -g)" >> .env
mkdir -p vault config/ssh
docker compose up -d
```

**Use a second bot for the first run if a deployment already exists.** Telegram
long-polling does not share: two gateways holding the same token fight over
every update, each getting some fraction of the messages, and the symptom is a
Registrar that answers intermittently rather than one that fails. Either stop
the old gateway first, or ask @BotFather for a throwaway bot.

`TELEGRAM_ALLOW_FROM` is the numeric chat id and the entrypoint refuses to
start without it. Unset, OpenClaw's `dmPolicy` defaults to `pairing`, which
puts anyone who finds the bot one step from an agent that has a shell.

To find the id: message the bot once, then

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
```

and read `result[].message.from.id`.

## What happens on every boot

The `gateway` service's entrypoint is idempotent by design, so a restart, an
image upgrade and a first run all take the same path:

1. **Preflight.** Refuses on a missing token, a missing allowlist, an
   `@username` where a numeric id belongs, or a vault it cannot write. Warns
   on missing IGDB credentials, because a provider being unavailable is exit 6
   and the local work still commits.
2. **Git.** `safe.directory` for the bind-mounted vault, and a commit identity.
   Both are failures that only surface at the first maintenance tick, and both
   read as something else when they do.
3. **Vault.** `gamereg init` only when there is no `gamereg.config.json`;
   `git init` only when there is no `.git`. An existing vault is never touched.
4. **Agent files.** The skill directory is **replaced** every boot — it is
   code, so pulling a new image redeploys it. The `workspace/*.md` persona
   files are **seeded once** and never overwritten, because they become yours
   the moment you edit them.
5. **Model auth.** `openclaw onboard --non-interactive`, once, when
   `OPENCLAW_AUTH_KEY` is set. Nothing refuses to boot without it — the
   gateway starts, the channel connects, and the agent never answers, which
   looks like a prompt problem and is not. It runs before the agent files are
   deployed, because onboard would otherwise seed OpenClaw's own default
   workspace files and step 4 does not replace a file that already exists.
6. **Gateway config.** The shipped example is seeded once; the values that
   belong to this installation — bot token, allowlist, approvers — are patched
   from the environment on every boot, so changing `.env` and restarting moves
   them.

Then the gateway starts, and once it reports healthy the one-shot `provision`
service registers the hourly check-in job. That job cannot be registered
earlier: `openclaw cron add` is a gateway *client* command and needs a gateway
to talk to.

> **After an image upgrade, send `/reset` in the chat.** A conversation already
> under way keeps the copy of the skill it loaded at session start. Restarting
> the container does not change that, and the symptom is a Registrar behaving
> like the previous version with no error anywhere.

## Things the first real run turned up

All of these were found by running the stack, not by reading documentation, and
all of them are already handled — they are here because the symptoms do not
point at the causes.

- **The gateway generates its own token, and needs one.** OpenClaw detects a
  container, switches its bind from loopback to `0.0.0.0`, and then refuses to
  start unauthenticated — correctly. The entrypoint writes a random token to
  `/config/.gateway-token` on first boot and reuses it. Set
  `OPENCLAW_GATEWAY_TOKEN` yourself if you would rather manage it.
- **`provision` shares the gateway's network stack.** OpenClaw refuses
  plaintext `ws://` to any non-loopback address, so reaching the gateway as
  `ws://gateway:18789` across the compose network is rejected outright. Sharing
  one loopback is cheaper than terminating TLS between two local containers.
- **`docker compose up` does not rebuild.** After editing anything in the image,
  `docker compose build` first — otherwise the stack silently runs the previous
  one, which is a confusing half-hour.
- **A new vault is committed at creation.** `autobuild.sh` treats "is the tree
  dirty" as its entire state and only ever stages build output, never
  `gamereg.config.json` or `.gitignore`. Left uncommitted, those two keep the
  tree dirty forever, and every tick runs an enrichment that reaches the
  network and a build with nothing to do. On a host a person commits them
  without thinking; nobody is here to.

- **The health check is a TCP connect, not `openclaw gateway health`.** The
  latter is a whole Node process — 0.4s on a laptop, minutes on a shared
  0.25 vCPU under memory pressure, which is longer than the check interval. The
  checks piled up, a dozen Node processes took the load average past 30, and
  they starved the boot they were waiting on. If you raise anything here, raise
  `GATEWAY_START_PERIOD`, not the frequency.
- **Boot takes minutes on an e2-micro**, and that is normal: each `openclaw`
  invocation in the entrypoint is a Node start. `docker compose up -d` blocks
  waiting on the health condition, so run it detached and poll
  `docker compose ps` rather than assuming it hung.
- **`HOME` is set in the image on purpose.** Compose overrides the image's user
  with the host's uid; when that uid is not in the container's `/etc/passwd`,
  Docker falls back to `HOME=/`, `git config --global` fails silently, and the
  vault's first commit aborts. It works on any host whose uid is 1000 and fails
  on every other, which is the sort of coincidence a container should remove
  rather than inherit.

## Pushing the vault

`scripts/autobuild.sh` commits and pushes on every tick that finds a dirty
tree. Without a remote it commits and stops, which is a supported setup.

With one, put a deploy key at `config/ssh/id_ed25519` and its `known_hosts`
beside it — the entrypoint wires `GIT_SSH_COMMAND` when it finds the key.
Generate `known_hosts` ahead of time, or the first push blocks forever on a
fingerprint prompt nobody can answer:

```bash
ssh-keyscan github.com > config/ssh/known_hosts
```

## The site

The default topology does not build the site here. The vault is already a git
repository that the maintenance loop pushes, so the cheapest correct answer is
to build it from that repository — a GitHub Action, or Cloudflare building on
push — which costs this machine no memory and no egress.
`scripts/vendor-quartz.sh` seeds a `wrangler.jsonc` for exactly that.

The `site` profile exists for installations that do not want an external
account, and for proving the shape works. It is not a good idea on 1 GB:

```bash
scripts/vendor-quartz.sh --clone --tag v5.0.0   # once, on the host
docker compose --profile site up -d
```

`gamereg build quartz` writes Quartz's *input*; the framework itself is
vendored separately by `scripts/vendor-quartz.sh`, which clones a third-party
repository and is therefore a deliberate step rather than something a boot does
on your behalf. The build container refuses to start without it rather than
half-working.

It watches the vault's git HEAD, not the filesystem. `gamereg build` rewrites
derived artifacts wholesale on every run, so mtimes move constantly and say
nothing about whether anything changed; a commit means the maintenance loop
found a real difference. A failed build leaves the previous site in place — a
stale page beats a blank one — and does not advance the stamp, so the next tick
retries.

There is no upstream image for this. Quartz's own Dockerfile runs
`npx quartz build --serve`, a development server with no `EXPOSE`, and
`ghcr.io/jackyzha0/quartz:hugo` is the abandoned v3 line.

### Running it on the machine after all

It does work, and the numbers are better than the warning above suggests --
with the agent stopped, `npm install` took 14s and the Quartz build 4s, about
two minutes from `up` to a served page. What it needs is the room: bring the
gateway down first, or accept that the whole stack together leaves ~280 MB
free and a load average around 4.

Four things had to be fixed before it worked at all, and each is the sort that
only appears on a machine that is not the one that wrote the file:

- **A partial `node_modules` is not self-healing.** An install interrupted
  once leaves the directory in place and incomplete, `npm install` over it does
  not reliably repair it, and every later build fails on a missing transitive
  dependency while the directory the check looks for sits right there. The
  guard is a sentinel written *after* a successful install.
- **Quartz removes and recreates its output directory**, and a bind mount
  point cannot be removed by anyone: `EACCES: permission denied, rmdir`. It
  builds into its own `public/` and the result is copied out.
- **A named volume is owned by root**, and every service here runs as the
  host's uid so the vault is not left owned by a stranger. The symptom is npm
  failing to create its log directory, which names neither ownership nor
  volumes. Everything is a bind mount now.
- **Nothing is mounted from the compose project directory.** The loop script
  and the serving config used to be, which works in a checkout and nowhere
  else -- on a machine holding only `compose.yml` and `.env`, Docker creates a
  directory at the missing path and the container dies on "Permission denied"
  or "are you trying to mount a directory onto a file". The script is in the
  image; the config is written by `site-build` into the directory it already
  shares with the server.

### Serving a build made somewhere else

On a 1 GB machine this is the shape that works: build the site where there is
memory, ship the static output, serve it with something that costs nothing.
Proven end to end on the e2-micro — Quartz's own `npm install` and build never
ran there at all, and the served result is byte-for-byte what the build
produced.

To look at it without opening a port, forward it over the connection you
already have:

```bash
ssh -L 8080:127.0.0.1:8080 <host>
```

`SITE_BIND` defaults to `127.0.0.1` for the same reason: publishing on
`0.0.0.0` should be a decision, not a default.

## Comments

```bash
docker compose --profile comments up -d
```

[Remark42](https://remark42.com) is a Go binary with an embedded BoltDB — no
database service, ~30 MB resident — which is affordable here in a way a site
build is not.

It has to be reachable by a browser, while the page it comments on is served
from somewhere else. A Cloudflare tunnel is what makes that work **without
opening a port** on a machine whose gateway runs a language model with a shell,
without a static address, and with no certificate to renew. Set
`CLOUDFLARE_TUNNEL_TOKEN` from the dashboard and point `REMARK_URL` at the
tunnel's hostname.

`REMARK_SECRET` signs the JWTs. Generate it with `openssl rand -hex 32` and
treat it as a secret — it lives in `.env`, which is gitignored.

## What is deliberately not here

- **No `/var/run/docker.sock` mount.** The gateway runs a language model with
  shell access; that socket is root on the host.
- **No published ports** in the default topology. Nothing needs to reach in.
- **No secrets in the image.** Everything comes from `.env`, which is
  gitignored, or from files mounted read-only.
