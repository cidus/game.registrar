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
5. **Gateway config.** The shipped example is seeded once; the values that
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
