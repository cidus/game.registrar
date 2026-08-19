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
npm install && npm link
```

`npm install` builds on its own via the `prepare` script; there is no separate
build step. See [docs/getting-started.md](../docs/getting-started.md) if this
host does not have a register yet — it needs one, and `gamereg init` is how it
gets one.

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

Four parts, and all four are required — any one missing and either nothing
is gated, or a gated command just fails outright with no way to approve it.

**The policy**, from step 3: `tools.exec.security: "allowlist"` and
`tools.exec.ask: "on-miss"`. Skip these and the default is `security: "full"`
— unrestricted shell, allowlist file or not. Confirm what's actually in
effect:

```bash
openclaw approvals get
```

**The allowlist itself.** `openclaw approvals allowlist add <pattern>` only
takes a bare glob, no way to scope by argument — which matters below, not for
this step. Apply the file form either way, since it's the reproducible one:

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

**`amend` and `revoke` are on this allowlist, deliberately, not excluded.**
That was not the first design. Read on before copying this file as-is if
you'd rather keep the platform gate.

### Why amend/revoke moved off the platform gate, and what that trades away

The original design kept `amend`/`revoke` off the allowlist entirely, so any
attempt at either fell to `ask: "on-miss"` and required a real approval
before running — a technical backstop a model can't reason its way around,
independent of how well SKILL.md tells it to behave. That held up in
principle. In practice, once actually wired end to end (see the two sections
below — both are still real requirements for *other* unlisted commands, kept
for that reason), the approval message itself was the problem: full raw
command text, a UUID, sometimes a slash-command fallback to paste back — and
worse, when the routing wasn't fully configured, the agent **fabricated**
plausible-looking `/approve <uuid>` instructions instead of relaying an
honest "this isn't working." That's a real failure mode a determined skill
instruction didn't prevent — SKILL.md already said "never invent an id," and
the model didn't recognize an approval id as covered by that rule until it
was named explicitly.

Given a choice between fixing the display (not fully in this repo's control —
the message shows the real command being authorized, which is arguably the
point of an approval gate, not a bug) and moving the confirmation somewhere
with better UX, the second was chosen here. `amend`/`revoke` now run like any
other `gamereg` command; the confirmation is conversational, specified in
`SKILL.md`'s Safety section — state plainly what will change, wait for an
unambiguous yes, only then run it.

**What this costs, stated plainly:** there is no longer a mechanism that
stops a wrong `amend` if the model misjudges its own conversation — badly
worded context, a stale reference, a confident-sounding but incorrect
inference. The append-only log means nothing is destroyed even then (a bad
amend is one more amend away from fixed), but it is no longer *impossible*
for the agent to run one without a real yes, only *against instructions* for
it to. If that tradeoff doesn't sit right for your vault, revert to
`approvals.example.json`'s original `argPattern` excluding `amend`/`revoke`,
finish wiring the two sections below properly, and accept the clunkier
approval UI as the cost of the harder guarantee.

**Where the approval prompt goes, and whether Telegram can show one — still
real, for anything that isn't a clean `gamereg` call:** a chained command
(`gamereg build --json 2>&1 || gamereg build`, still refused — see below) or
any tool other than `gamereg` entirely still needs `ask: "on-miss"` to have
somewhere to go. Without `approvals.exec`, it fails immediately with *"Exec
approval is required, but no interactive approval client is currently
available."* `"session"` sends the prompt back into whatever chat the
command came from:

```json5
approvals: {
  exec: { enabled: true, mode: "session" },
},
```

And without `channels.telegram.execApprovals`, a correctly-routed prompt
still fails, with a different message: *"native chat exec approvals are not
configured on Telegram... Approve it from the Web UI or terminal UI for
now."* `enabled: true` alone, relying on `allowFrom` to infer the approver,
was tried first and confirmed **not** sufficient — the exact same failure
recurred on a fresh attempt afterward. An explicit `approvers` list is what
actually worked, confirmed with a real approval that genuinely paused and
resolved on an actual Telegram inline tap (`exec.approval.waitDecision`,
~12s, in the gateway log):

```json5
channels: {
  telegram: {
    execApprovals: {
      enabled: true,
      approvers: ["PUT_YOUR_NUMERIC_CHAT_ID_HERE"],
    },
  },
},
```

`enabled: true` alone was enough to change the failure and pick up the
existing `allowFrom` as the approver — no separate `approvers` list needed.
That much is confirmed; the actual click-through (does a real tap in
Telegram approve the command) still wants a real test, since nothing short of
a phone in hand verifies that part.

Also worth knowing, separate from approvals: **a single `gamereg` invocation
per exec call, never chained.** The allowlist matches the command string as
given — `gamereg build --json 2>&1 || gamereg build` is a different, unlisted
command even though both halves are `gamereg`, and it falls straight into the
same approval-required path above. `SKILL.md` tells the agent this
explicitly; it's noted here because the failure mode looks identical to a
missing-approvals-config case and is easy to misdiagnose as the same bug.

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

In order, from your phone, with no terminal open. Say each of these in whatever
language you actually talk to the bot in — the skill is written in English, and
the words the bot narrates with come from `gamereg vocab` in the language you
are speaking, so neither the steps nor the results depend on which language you
pick. If you see an English term like "filed" land in the middle of a sentence
in your language, the skill did not deploy as edited: that is the one symptom
this command exists to remove.

1. "starting hollow knight" → a session opens, and you are *not* asked for a
   platform
2. Send a photo mid-session → it is held for the session's close
3. A voice note: "just stopped, got to the Watcher Knights" → the session closes,
   the note is your words, and the platform question arrives *now* if it is
   still open
4. A title that matches several games → inline buttons, one tap, no retyping
5. "done, 9 out of 10, hard" → the run closes
6. Accept a drafted verdict → it is filed as written
7. "how many hours did I play this year?" → a number that came from SQL. On a
   genuinely fresh vault this is also the first thing to exercise `data/log.db`
   not existing yet — the agent should run `gamereg build` itself and retry
   rather than reporting a dead end; if it doesn't, the skill didn't deploy
   as edited.

Then, from a terminal: `gamereg build`, and check that the notes regenerate and
carry `source: "chat"` on the events.

Last: message the bot from another account, and confirm nothing happens.

## What is not here

Check-ins (`due`, `checkin`, cron, the backoff ladder), reaction tokens and
stickers are specified in `docs/spec/05-agent.md` but belong to phase 3. Nothing
in this directory implements them, and the Registrar stays silent until spoken
to.
