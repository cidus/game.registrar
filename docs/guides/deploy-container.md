# Deploy with containers

Run the register, the chat agent and vault maintenance from the published
image. Nothing is cloned: `compose.yml` and a `.env` file are the whole
installation.

This page is the procedure. What the stack contains — services, mounts, the
boot sequence — is in [Container reference](../reference/container.md), and the
variables are in [Environment](../reference/environment.md).

## Before you start

- A machine with Docker and Compose, 1.5 GB of RAM and swap. See
  [machine requirements](../reference/container.md#machine-requirements).
- A Telegram bot token from [@BotFather](https://t.me/botfather). Use a bot of
  its own: Telegram allows one consumer per token, so a second gateway on the
  same token makes the register answer only sometimes.
- A model credential: a Claude subscription token (`claude setup-token`), an
  API key, or an OpenRouter key.
- Optional: IGDB credentials for metadata and cover art, and a git remote for
  the vault.

## 1. Prepare the host

Swap is required, not advisory: without it the OOM killer arrives
mid-conversation.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Download the two files

```bash
curl -O https://raw.githubusercontent.com/cidus/game.registrar/main/compose.yml
curl -o .env https://raw.githubusercontent.com/cidus/game.registrar/main/.env.example
```

## 3. Fill in `.env`

Edit the values that are already in the file rather than appending new lines; a
key defined twice is confusing to read even where the parser tolerates it.

| Set | To |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token BotFather gave you |
| `TELEGRAM_ALLOW_FROM` | leave **empty** unless you already know your numeric chat id — step 5 explains |
| one model credential | `CLAUDE_CODE_OAUTH_TOKEN`, or `OPENCLAW_AUTH_KEY` with `OPENCLAW_AUTH_CHOICE`, or `OPENROUTER_API_KEY` |
| `PUID`, `PGID` | the output of `id -u` and `id -g`, so the vault is owned by you |
| `GAMEREG_TIMEZONE`, `GAMEREG_LOCALE`, `GAMEREG_DAY_CUTOFF`, `GAMEREG_TARGETS` | your own values. They are applied only when the vault is first created |
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | optional; without them `enrich` is skipped and everything else still works |

> [!IMPORTANT]
> The model credential is the one thing that does not announce itself as
> missing: without it the gateway starts, Telegram connects, and nothing ever
> answers.

Voice notes are transcribed through the shipped hosted entry, which uses
OpenRouter — set `OPENROUTER_API_KEY` if you want voice, even when the model
itself runs on a Claude subscription.

## 4. Start the stack

```bash
mkdir -p vault config/ssh
docker compose up -d
```

`up -d` waits for the gateway's health condition. On a small machine the first
boot takes minutes, because every step of the boot sequence is a Node process.
Watch it rather than assuming it hung:

```bash
docker compose ps
docker compose logs -f gateway
```

## 5. Pair your Telegram account

With `TELEGRAM_ALLOW_FROM` empty the gateway starts in pairing mode. Message
the bot: it answers with your own numeric id, a one-time code and the command
that approves it. Run that command on the host:

```bash
docker compose exec gateway openclaw pairing approve telegram <code>
```

This is also the only practical way to learn your id: no Telegram client shows
it, and the Bot API will not resolve a username
([ADR 0080](../decisions/0080-telegram-pairing-reveals-the-sender-id.md)).

An allowlist is the alternative, not the next step: set `TELEGRAM_ALLOW_FROM`
to your numeric id and restart. The two lists never merge, so switching to an
allowlist after pairing means copying the id across by hand.

## 6. Check that it works

```bash
docker compose ps                                   # gateway healthy, provision exited 0
docker compose logs gateway | grep entrypoint       # the boot sequence
docker compose exec gateway gamereg status --json   # the register answers
```

Then send the bot a message. If it replies like a generic assistant, see
[Troubleshooting](troubleshooting.md).

## 7. Push the vault to a remote (optional)

The maintenance loop commits every tick that finds a dirty tree, and pushes if
the vault has a remote. Without one it commits and stops, which is a supported
setup.

To push, add the remote and give the container a deploy key:

```bash
git -C vault remote add origin git@github.com:<you>/<your-register>.git
ssh-keygen -t ed25519 -f config/ssh/id_ed25519 -N ''
ssh-keyscan github.com > config/ssh/known_hosts
```

Add the public key as a deploy key with write access on the remote, then
restart the maintenance service.

> [!WARNING]
> Create `config/ssh/` and its `known_hosts` **before** the stack starts. If
> the path does not exist, Docker creates an empty directory owned by root, and
> pushes fail with `Host key verification failed`, which names neither the key
> nor the mount. Host key checking is strict, so a missing `known_hosts` fails
> immediately rather than prompting.

## Update, pin and roll back

```bash
docker compose pull && docker compose up -d
```

A running stack keeps the image it started with, and `:edge` moves, so `up -d`
alone does not fetch a newer one. To pin a version or go back to one, set the
tag and recreate:

```bash
echo "GAMEREG_IMAGE_TAG=sha-7ab6b0e" >> .env
docker compose up -d
```

> [!NOTE]
> After an upgrade, send `/reset` in the chat. A conversation already under way
> keeps the copy of the skill it loaded when it started, so without a reset the
> Registrar behaves like the previous version with no error anywhere.

## Build the image from a checkout

For development, or to run a change before it is published:

```bash
docker compose -f compose.yml -f compose.build.yml build
docker compose -f compose.yml -f compose.build.yml up -d
```

## Optional profiles

| Profile | What it adds | Guide |
|---|---|---|
| `site` | Builds the Quartz site here and serves it | [Publish a site](publish-site.md) |
| `comments` | Remark42 comments | [Comments](comments.md) |
| `tunnel` | Reachable from outside, with no published port | [Comments](comments.md) |

All three are off by default. On a 1 GB machine, leave `site` off: a Quartz
build peaks at 400–700 MB and the default topology builds the site from the
repository the maintenance loop already pushes
([ADR 0036](../decisions/0036-site-built-off-box-by-default.md)).

## Moving from a host install

Stop the old gateway **and disable it**: `systemctl --user stop` leaves the
unit enabled, so the next reboot starts it alongside the container — two
consumers of one bot token, and a register that answers sometimes.

```bash
systemctl --user disable --now openclaw-gateway.service
systemctl --user disable --now gamereg-autobuild.timer
```

Point `GAMEREG_VAULT_PATH` at the existing vault. An existing vault is never
re-initialised. If it is not a git repository yet, make it one before starting,
because the boot only creates a repository for a vault it seeds itself.

## Next steps

- [Chat agent](chat-agent.md) — voice, reactions and a smoke test.
- [Troubleshooting](troubleshooting.md) — symptoms, causes and fixes.
- [Container reference](../reference/container.md) — services, mounts, boot.
- [Environment](../reference/environment.md) — every variable.
