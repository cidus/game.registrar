# Security model

What an installation exposes, what protects it, and where the secrets are. To
report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## What is being protected

A register is personal: what you played, when, what you thought, and the photos
you attached. The CLI alone is a local program over local files, so its threat
model is small. The chat agent and the container change that, because they add
a language model with a shell and, optionally, services a stranger can reach.

## The CLI

- **Nothing is destroyed.** The event log is append-only; `amend` and `revoke`
  append corrections and the original event stays on record (invariants 1
  and 6).
- **Arguments are validated.** An invalid enum, a negative duration or an
  out-of-range rating is refused, so a caller cannot write nonsense into the
  log — including a caller that is a model.
- **Only two commands reach the network**, `enrich` and `search`, and neither
  writes a record without being asked to. No recording command performs network
  I/O at all (invariant 5).
- **The only deletion is the build's**, and it removes only files a manifest
  says a target owns, never by pattern
  ([ADR 0030](../decisions/0030-deletion-is-one-manifest-whitelist.md)).
- **`gamereg query` is a boundary, not a convenience.** It accepts a single
  read-only statement and refuses the rest, including the reserved `pragma_`
  and `sqlite_` namespaces, which a word-boundary check had let through
  ([ADR 0090](../decisions/0090-query-guard-refuses-reserved-namespaces.md)).
- **EXIF is stripped on ingest**, GPS included, from every copy a photo
  produces — the full-resolution `images.keep_original` copy too — and it is not
  configurable off (invariant 12).

## The agent

Assume the chat channel is reachable by others.

- **Who may talk to it.** Either an allowlist of numeric sender ids, or pairing,
  which answers a stranger with their own id and a one-time code and waits for
  an approval. Pairing is a request queue, not an open door — but it does reply
  to strangers, by design
  ([ADR 0080](../decisions/0080-telegram-pairing-reveals-the-sender-id.md)).
- **What it may execute.** An exec allowlist, in allowlist mode. Without that
  mode the default is unrestricted, allowlist file or not.
- **Which tools it can see.** `tools.allow` is `exec`, `message` and `read`.
  This is the control that actually holds: prose forbidding a tool did not
  ([ADR 0064](../decisions/0064-boundaries-by-tools-allow.md)).
- **What it can reach in the register.** One binary. It writes no file itself,
  and every number it reports comes from the database.
- **Accepted risk.** `amend` and `revoke` are on the allowlist and their
  confirmation is conversational, so a wrong correction is possible if the
  model misjudges a conversation. It is one more `amend` from fixed, and
  nothing is destroyed
  ([ADR 0008](../decisions/0008-amend-revoke-confirmed-in-conversation.md)).
- **Prompt content is instructions, not data.** Anything the agent reads from a
  message — a title, a note, a photo caption — reaches the CLI as an argument
  that the CLI validates. That is the boundary that makes injection expensive:
  the worst case is a wrong record, which is correctable, rather than a
  filesystem write.

## The container

- **No Docker socket is mounted.** The gateway runs a model with shell access,
  and that socket is root on the host. It is also why the site loop watches the
  vault's git HEAD instead of being triggered from outside.
- **No published port** in the default profile set. Telegram is long-polled, so
  nothing needs to reach in. `site-serve` publishes one only under the `site`
  profile, bound to `127.0.0.1` unless you change `SITE_BIND`.
- **The public-facing service gets named variables.** `remark42` has no
  `env_file`: Compose would hand it the whole file, which is how it once held
  the model credential, the bot token, the tunnel token and the IGDB keys, none
  of which it reads
  ([ADR 0089](../decisions/0089-public-service-gets-named-variables.md)).
- **The site build cannot write to the register.** `/vault` is mounted
  read-only there and the Quartz tree is staged elsewhere, because a Quartz
  build runs third-party plugin code and `npm install` runs a dependency tree's
  lifecycle scripts
  ([ADR 0076](../decisions/0076-site-profile-builds-in-the-gamereg-image.md)).
- **The gateway authenticates its own clients.** In a container it binds
  `0.0.0.0` and refuses to start without a token; the entrypoint generates one
  into `/config/.gateway-token` with mode 600.
- **No secret is baked into the image.** Secrets come from `.env` or read-only
  mounts, and `.dockerignore` keeps a filled `.env` out of a local build's
  layers and cache.

## Where the secrets are

| Secret | Lives in | Notes |
|---|---|---|
| IGDB credentials | `gamereg.secrets.json` in the vault, or `IGDB_*` | `gamereg init` gitignores the file. It is created with the default umask, so check its mode if the machine has other users. |
| Model credential | The gateway's own auth store, under `/config` | Present in `.env` too, which is how the boot installs it ([ADR 0081](../decisions/0081-credentials-in-the-auth-store.md)). |
| Telegram bot token | `.env`, patched into the gateway configuration each boot | A second bot's token, for comment sign-in, is a different secret. |
| Gateway access token | `/config/.gateway-token` | Generated if you do not supply one. |
| Vault push key | `config/ssh/id_ed25519`, mounted read-only | Strict host key checking, with a `known_hosts` you provide. |
| Remark42 signing secret, tunnel token | `.env`, named explicitly into their services | The tunnel token is passed through the environment, never argv, where it would be world-readable. |

**No secret is ever collected in a conversation.** A chat transcript is stored
in plaintext on the gateway host, so anything typed into the chat is stored
there too. Configuration that must be secret belongs in `.env` or a file, not
in a message to the Registrar.

## Publishing

The site publishes only what you tell it to. `images.publish` is off by
default, and with it off the pages say where a picture was withheld rather than
linking one that is not there
([ADR 0055](../decisions/0055-one-publish-switch-rendered.md)). Turning it off
later does not unpublish what was already mirrored: the mirror only ever adds,
so delete `quartz/content/assets/` yourself and commit.

Comments are a separate decision again: Remark42 is the one component here that
strangers interact with directly, and it holds its own data.
