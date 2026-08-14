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
numeric chat id — the bot only ever answers you, and `@username` is not what the
allowlist matches.

### 3. Configure OpenClaw

Copy the parts of `openclaw.example.json5` you need into
`~/.openclaw/openclaw.json5`. Fill in the token and your chat id.

**`allowFrom` is not optional.** The agent has shell access and the bot is
reachable by anyone who finds it.

### 4. Set the environment the CLI reads

These go on the gateway *process*, which the commands it spawns inherit — in
the systemd unit, the launchd plist, or wherever you start OpenClaw. Not in
`openclaw.json5`.

```bash
export GAMEREG_VAULT="/path/to/your/vault"
export GAMEREG_SOURCE=chat
export GAMEREG_NON_INTERACTIVE=1
```

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

Copy `approvals.example.json` into OpenClaw's approvals file (`openclaw
approvals --help` will tell you where, and can add entries for you).

One entry, deliberately narrow: `gamereg` and nothing else, with no path-only
entry, so the binary is restricted to arguments matching `argPattern`.

The negative lookahead keeps **`amend` and `revoke` out of the allowlist on
purpose.** Those are how a mistake in an append-only log gets corrected, and
leaving them unlisted means OpenClaw asks you before either runs. A prompt
instruction saying "never call amend" is advice a model can talk itself out of;
an approval prompt is not.

Known cost, stated plainly: this is a regex over argv, not typed validation. A
`--note` whose text contains the word "revoke" will ask for an approval it does
not need. It fails toward asking, which is the right direction — and it is the
reason a small MCP server with per-argument validation is the eventual answer
rather than this.

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
