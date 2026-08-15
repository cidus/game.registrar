# The agent layer

Everything here is optional. The CLI works without it, and nothing in `src/`
depends on any of it.

`docs/spec/05-agent.md` is the specification. This directory is one
implementation of it, for [OpenClaw](https://openclaw.ai) — the reference
gateway named in the spec, though any gateway that can shell out works.

```
skills/gamereg/
  SKILL.md              the agent prompt
  reference/cli.md      the CLI surface, kept honest by test/agent-skill.test.ts
  reference/query.md    how to answer questions in SQL
openclaw.example.json5  channel, allowlist, voice transcription
approvals.example.json  which commands the agent may run unattended
```

## What the agent is allowed to be

It turns a message into a `gamereg` invocation and relays the result. It does
not read or write vault files, does not compute durations, and does not invent
identifiers. Every number it reports comes from the database.

That boundary is not decoration: it is what keeps the register correct when the
model is wrong. A mis-heard title costs one alias. A model that did its own
arithmetic would cost every statistic downstream, silently.

## Setup

### 1. Install `gamereg` on the always-on host

```bash
npm install && npm run build && npm link
```

Check it: `gamereg status --json` from inside your vault.

### 2. Create the bot

Create it through Telegram's BotFather and keep the token. Then get your own
numeric chat id — the bot only ever answers you, and `@username` is not what
the allowlist matches. Easiest way: message the bot once (anything, `/start`
is fine), then read your id back from the Bot API directly —

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
```

— it's `result[].message.from.id`, a plain integer, in the reply.

While you're in BotFather, run `/setjoingroups` and disable it. This bot is
DM-only; there's no reason it should be addable to a group at all.

### 3. Configure OpenClaw

`openclaw.example.json5` isn't just channel config — it also carries the
`tools.exec` policy that step 6 depends on. Fill in the token and chat id,
then apply the whole file rather than hand-copying pieces of it:

```bash
openclaw config patch --file agent/openclaw.example.json5 --dry-run
openclaw config patch --file agent/openclaw.example.json5
```

**`dmPolicy: "allowlist"` and `allowFrom` are not optional.** Left unset,
`dmPolicy` defaults to `"pairing"` — not blocked, just one extra step for a
stranger who finds the bot. The agent has shell access; don't rely on the
softer default.

### 4. Set the environment the CLI reads

These go in `~/.openclaw/.env`, not in `openclaw.json5` and not in the
systemd unit's own `Environment=` lines. OpenClaw resolves each exec call's
environment from the parent process, the working directory's `.env`, and this
global fallback file — merged fresh per call, not baked in once at gateway
startup — which is exactly why this file is the right place and a `restart`
(not a reinstall) is enough to pick up a change.

```bash
cat >> ~/.openclaw/.env <<'EOF'
GAMEREG_VAULT=/path/to/your/vault
GAMEREG_SOURCE=chat
GAMEREG_NON_INTERACTIVE=1
EOF
chmod 600 ~/.openclaw/.env
systemctl --user restart openclaw-gateway.service
```

Don't confuse this with `OPENCLAW_SERVICE_MANAGED_ENV_KEYS` — that's a
different, narrower mechanism OpenClaw uses to bake specific keys it
recognizes (the model auth token, the channel bot token) directly into the
systemd unit at `gateway install` time. `GAMEREG_*` keys aren't in that list
and don't need to be; the exec-time resolution above already covers them.

`GAMEREG_SOURCE=chat` stamps every event the gateway files, so the log tells you
later what came from a phone and what came from a terminal. An unknown value is
refused outright — the log is append-only and a typo here would be permanent.

`GAMEREG_NON_INTERACTIVE=1` matters more than it looks. Some agent harnesses
allocate a pty; under one, the CLI would think a human is present and sit
forever on a prompt nobody can answer.

### 5. Install the skill

```bash
cp -R agent/skills/gamereg ~/.openclaw/workspace/skills/
```

### 6. Restrict what it may run

Two parts, and both are required — either alone does nothing.

**The policy**, from step 3: `tools.exec.security: "allowlist"` and
`tools.exec.ask: "on-miss"`. Skip these and the default is `security: "full"`
— unrestricted shell, allowlist file or not. Confirm what's actually in
effect:

```bash
openclaw approvals get
```

**The allowlist itself.** `openclaw approvals allowlist add <pattern>` only
takes a bare glob — no `argPattern` — so the constrained entry that keeps
`amend`/`revoke` out needs the file form instead:

```bash
openclaw approvals set --file agent/approvals.example.json
```

Fill in your service account's actual home path for the second (absolute
path) entry, or drop it — in testing, the exec tool always ran `gamereg`
through a shell as a bare command, so only the bare-name pattern ever
matched (`openclaw approvals get` shows "Last Used" per entry — check it
after a real invocation rather than assuming). The absolute-path entry is
kept as cheap insurance in case a future OpenClaw version invokes
differently.

The negative lookahead keeps **`amend` and `revoke` out of the allowlist on
purpose.** Those are how a mistake in an append-only log gets corrected, and
leaving them unlisted means OpenClaw asks you before either runs, per the
`ask: "on-miss"` policy above. A prompt instruction saying "never call amend"
is advice a model can talk itself out of; an approval prompt is not.

Known cost, stated plainly: this is a regex over argv, not typed validation. A
`--note` whose text contains the word "revoke" will ask for an approval it does
not need. It fails toward asking, which is the right direction — and it is the
reason a small MCP server with per-argument validation is the eventual answer
rather than this.

### A permissions trap worth knowing about up front

If your vault lives somewhere that needs a shared group — not the service
account's own home directory — and you create that group *after* the gateway
has already been started once (including via `loginctl enable-linger`),
restarting the gateway service alone will not pick it up. Supplementary group
membership is resolved at login/session start, and `systemctl --user restart
<service>` only restarts the service within the *existing* session — it does
not re-login.

The symptom is an exec failure with `EACCES: permission denied, mkdir
'<vault>/data'` on the very first write, even though the same command run by
hand over a fresh SSH connection works fine (a new SSH connection is a fresh
login, and does pick up the new group). Confirm the mismatch directly —

```bash
id                                                                # your groups
PID=$(systemctl --user show -p MainPID --value openclaw-gateway.service)
cat /proc/$PID/status | grep ^Groups                              # the gateway's
```

— and if the gateway is missing the group, the fix is restarting the whole
per-user session manager, not just the one service:

```bash
sudo systemctl restart user@<your-uid>.service
```

This is a full user-session restart, not a service restart — it will
briefly interrupt every `systemd --user` unit for that account. Confirm the
group came through afterward with the same `/proc/$PID/status` check above.

### 7. Voice

`tools.media.audio` transcribes voice notes before the CLI sees anything.
`gamereg` never touches audio and must never be asked to.

Hosted transcription is better on pt-BR out of the box; local Whisper keeps the
audio on the machine and costs nothing per minute. Try both with the titles you
actually say out loud — that, and not a benchmark, is what decides it.

Either way, transcribed titles are unreliable. That is what the alias table is
for: the user corrects a mangled title once, with `gamereg alias`, and the
register recognizes it from then on.

## Smoke test

In order, from your phone, with no terminal open:

1. "começando hollow knight" → a session opens, and you are *not* asked for a
   platform
2. Send a photo mid-session → it is held for the session's close
3. A voice note: "parei agora, cheguei no Watcher Knights" → the session closes,
   the note is your words, and the platform question arrives *now* if it is
   still open
4. A title that matches several games → inline buttons, one tap, no retyping
5. "acabei, nota 9, difícil" → the run closes
6. Accept a drafted verdict → it is filed as written
7. "quantas horas eu joguei esse ano?" → a number that came from SQL

Then, from a terminal: `gamereg build`, and check that the notes regenerate and
carry `source: "chat"` on the events.

Last: message the bot from another account, and confirm nothing happens.

## What is not here

Check-ins (`due`, `checkin`, cron, the backoff ladder), reaction tokens and
stickers are specified in `docs/spec/05-agent.md` but belong to phase 3. Nothing
in this directory implements them, and the Registrar stays silent until spoken
to.
