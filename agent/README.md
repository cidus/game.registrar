# The agent layer

Optional. The CLI works without it and nothing in `src/` depends on it.

`docs/spec/05-agent.md` is the specification; this directory is one
implementation of it for [OpenClaw](https://openclaw.ai). Any gateway that can
shell out would do.

This file covers what the agent *is* and the traps found running it. For the
container deployment — which is how this is actually run — see
[docs/deploy-container.md](../docs/deploy-container.md); the *Setup* section
below is the host install it replaced, still supported and still the clearest
description of what the container does for you.

## What the agent is allowed to be

It turns a message into a `gamereg` invocation and relays the result. It does
not read or write vault files, does not compute durations, and does not invent
identifiers. Every number it reports comes from the database.

That boundary is what keeps the register correct when the model is wrong. A
mis-heard title costs one alias. A model doing its own arithmetic would cost
every statistic downstream, silently.

## How it fits together

| Part | Runs where | Does what |
|---|---|---|
| `gamereg` | the host, on `PATH` | every write and every read; the only thing the agent may execute |
| OpenClaw gateway | the host | receives messages, runs the model, executes the allowlisted binary |
| `workspace/` + `skills/` | copied into the gateway's workspace | the prompt: boundary, procedure, persona |
| `checkin.sh` | cron, on the host | the hourly check-in poll — CLI only, no model |
| `scripts/autobuild.sh` | a timer, on the host | enrich, build, commit, push when the vault is dirty |

The last two are deliberately *not* the agent's: it executes one allowlisted
binary and writes no file itself.

```
workspace/
  AGENTS.md             the operating card: in context on every turn
  SOUL.md               the persona
  IDENTITY.md           name, creature, vibe
  REACTIONS.md          the per-installation token mapping
  TOOLS.md              holds the slot; OpenClaw reseeds its own if deleted
skills/gamereg/
  SKILL.md              a pointer; the standing orders are in AGENTS.md
  reference/cli.md      the CLI surface, kept honest by test/agent-skill.test.ts
  reference/query.md    the SQL schema and how to answer questions with it
  reference/media.md    candidate menus, photos, covers, reactions
  reference/corrections.md  amend, revoke, undoing a mistake
  reference/checkins.md the check-in wake and its three exits
openclaw.example.json5  channel, tool allowlist, voice transcription
approvals.example.json  which commands the agent may run unattended
checkin.sh              the hourly check-in poll
```

### Where the prompt lives, and why it is split this way

One fact about the gateway decides the whole layout: **`workspace/*.md` is
compiled into the system prompt on every turn and cached there; a skill body is
a `read` tool call the model pays for, mid-turn, once per session.**

| Where | What is in it | Cost |
|---|---|---|
| `workspace/AGENTS.md` | boundary, JSON contract, call budget, common path, buttons, safety | always in context |
| `workspace/SOUL.md` | voice, the register's vocabulary | always in context |
| `skills/gamereg/SKILL.md` | a pointer back to the card | one small read |
| `skills/gamereg/reference/*.md` | one file per rare flow | read only when that flow happens |

A session that opens, pauses, resumes, finishes and files a verdict reads no
file at all. A correction or a check-in reads exactly the one that covers it.

`test/agent-skill.test.ts` holds a size budget over `workspace/*.md`. Raising
it is allowed; doing so by accumulation is what the budget exists to prevent.

**`workspace/TOOLS.md` cannot be deleted, only replaced.** Removed once, it was
reseeded by OpenClaw within the hour as a generic page about camera names, SSH
hosts and TTS voices — which then sits in the system prompt describing
capabilities this deployment does not have. The slot is occupied either way;
the only choice is by what. `USER.md` and `HEARTBEAT.md` ship for the same
reason, and the budget above is only meaningful because of it: every file in
the deployed prompt is a file in `agent/workspace/`.

### Who owns which file

| File | Policy | Why |
|---|---|---|
| `skills/gamereg/**` | replaced every boot | code |
| `AGENTS.md`, `TOOLS.md` | replaced every boot | code — asserted against the real binary in CI |
| `SOUL.md`, `IDENTITY.md`, `REACTIONS.md` | yours | voice, identity, per-install sticker ids |
| `USER.md` | yours | house rules; never beats *Safety* in `AGENTS.md` |
| `HEARTBEAT.md` | yours | comments only, which is what keeps it inert |

The container records the hash of each file it seeds, so a later boot can tell
an edit from a shipped default that moved. Untouched, a file follows the image
with no action from anyone. Edited, it is kept and the boot logs a `NOTICE`
naming the shipped copy and saying that deleting yours takes the new one.

### The tool surface is part of the prompt

OpenClaw exposes 39 tools by default, whose schemas measured 53,768 characters
— about 13k tokens re-sent every turn — against a 45,615-character system
prompt. This agent uses three: `exec`, `message`, `read`.

Cost is half of it. **A tool schema outranks a paragraph:** `AGENTS.md` and
`SKILL.md` both forbid reading session history and keeping notes, and the
transcripts still show `sessions_history` seven times and `memory_search`
three. Every one was a boundary the prompt stated and the tool list reopened.

`tools.allow: ["exec", "message", "read"]` closes it by construction.
`thinkingDefault` moved from `high` to `adaptive` in the same pass — most turns
map one sentence to one invocation. **The gateway must be restarted for either
to take effect;** there is no config-reload path.

## Setup

For the container, read [docs/deploy-container.md](../docs/deploy-container.md)
instead — it does steps 1 and 3 through 9 for you. What follows is the host
install.

### 1. Install `gamereg`

```bash
npm install && npm link
```

`npm install` builds via the `prepare` script. Check with `gamereg status
--json` from inside your vault; see
[docs/getting-started.md](../docs/getting-started.md) if this host has no
register yet.

### 2. Create the bot

Through BotFather. Keep the token, then get your own **numeric** chat id — the
allowlist does not match `@username`. Message the bot once, then:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
```

It is `result[].message.from.id`. While in BotFather, `/setjoingroups` off —
this bot is DM-only. `/setuserpic` sets the avatar; `PERSONAS.md` has the
prompts that generated it.

### 3. Configure OpenClaw

`openclaw.example.json5` carries the channel config *and* the `tools.exec`
policy step 6 depends on. Fill in the token and chat id, then apply the whole
file:

```bash
openclaw config patch --file agent/openclaw.example.json5 --dry-run
openclaw config patch --file agent/openclaw.example.json5
```

**`dmPolicy: "allowlist"` with your id in `allowFrom` is not optional.** Unset,
it defaults to `"pairing"` — a request queue, not an open door: a stranger gets
their own id and a one-time code back, and nothing happens until you run
`openclaw pairing approve telegram <code>`.

Pairing is also the only way to *find* your id if you skipped the `getUpdates`
route: no Telegram client shows it and the Bot API will not resolve a username.
Pair once, read the id, then switch to `allowlist` — and copy the id across by
hand, because `allowlist` ignores the pairing store entirely.

### 4. Set the environment the CLI reads

In `~/.openclaw/.env`, not in `openclaw.json5` and not in the systemd unit.
OpenClaw merges each exec call's environment fresh from this file, so a
restart picks up a change.

```bash
cat >> ~/.openclaw/.env <<'EOF'
GAMEREG_VAULT=/path/to/your/vault
GAMEREG_SOURCE=chat
GAMEREG_NON_INTERACTIVE=1
EOF
chmod 600 ~/.openclaw/.env
systemctl --user restart openclaw-gateway.service
```

`GAMEREG_SOURCE=chat` stamps every event, so the log says later what came from
a phone and what from a terminal; an unknown value is refused outright, since
the log is append-only. `GAMEREG_NON_INTERACTIVE=1` stops the CLI waiting on a
prompt nobody can answer when a harness allocates a pty.

### 5. Install what the agent reads

Both halves are required: the skill is the procedure, the workspace files are
the standing orders and the persona.

```bash
cp -R agent/skills/gamereg ~/.openclaw/workspace/skills/
cp agent/workspace/*.md ~/.openclaw/workspace/
```

On a host this is a copy you repeat after every `git pull`, and `AGENTS.md` is
the one that matters — it is code, and a stale copy means the agent follows
last release's procedure. The container does it per file with hash tracking
(*Who owns which file* above); nothing does it for you here.

`PERSONAS.md` is deliberately not among them — it is a design document for
whoever draws a character and the agent has no use for it.

### 6. Restrict what it may run

The policy came from step 3 (`tools.exec.mode: "allowlist"`). Add the
allowlist itself:

```bash
openclaw approvals set --file agent/approvals.example.json
openclaw approvals get          # confirm what is actually in effect
```

Without `mode: "allowlist"` the default is `"full"` — unrestricted shell,
allowlist file or not. In `allowlist` mode anything outside it is refused
immediately as a plain tool error the agent recovers from, with nothing sent to
the user. (`mode` replaced `security` + `ask` in OpenClaw 2026.8; the pair is
refused when combined, and `openclaw doctor --fix` migrates a saved config.) `amend` and `revoke` are on this allowlist deliberately; see
*Why amend/revoke are not behind an approval gate* below before copying the
file as-is.

### 7. Voice

`tools.media.audio` transcribes voice notes before the CLI sees anything;
`gamereg` never touches audio. Hosted transcription is better on pt-BR out of
the box, local Whisper keeps the audio on the machine. Try both with the titles
you actually say out loud.

Transcribed titles are unreliable either way — that is what `gamereg alias` is
for: correct a mangled title once and the register knows it from then on.
Confirmed live: a session closed from a voice note, with the platform question
arriving afterwards exactly as it does for a typed close.

### 8. Wire the check-in poll

`agent/checkin.sh` runs `gamereg checkin --expire` and `gamereg due --json`,
exits silently when nothing is due, and otherwise wakes the agent and files a
`snoozed` check-in for each row — in that order, so a gateway that was down
leaves the session eligible next tick rather than silently in backoff.

Try it first — `--dry-run` touches nothing, `--at` pretends it is another time:

```bash
GAMEREG_VAULT=/opt/gamereg-vault ~/.openclaw/checkin.sh --dry-run
GAMEREG_VAULT=/opt/gamereg-vault ~/.openclaw/checkin.sh --dry-run --at "2026-08-23 09:00"
```

Then register it as an hourly **command** job — the binary with no model
attached, which is what makes an empty poll free:

```bash
cp agent/checkin.sh ~/.openclaw/checkin.sh
openclaw cron add --name gamereg-checkin --cron "0 * * * *" --exact --no-deliver \
  --command-env GAMEREG_VAULT=/opt/gamereg-vault \
  --command-env GAMEREG_CHECKIN_CHANNEL=telegram \
  --command-env GAMEREG_CHECKIN_TO=<your numeric chat id> \
  --command "$HOME/.openclaw/checkin.sh"
```

Every flag there is load-bearing:

- **`--cron`, not `--every 1h`.** `--every` counts from registration, so a job
  created at 09:58 polls at 09:58 forever.
- **`--exact`** zeroes the stagger window OpenClaw otherwise uses to spread
  jobs out. `chase_at` is a *delivery slot*: a tick at 09:58 delivers the
  morning chase 58 minutes late.
- **`--no-deliver`.** See *A command job's stdout is delivered by default*.
- **`--command-env`.** Inheritance is not a contract, and one inherited value
  is actively wrong — see *A command job inherits `GAMEREG_SOURCE`*.

`openclaw cron run <id>` fires a job on demand and works on a disabled one, so
creating it `--disabled --keep-after-run` first makes the whole loop
inspectable: run it, read `openclaw cron runs --id <job>`, then enable it.

### 9. Wire the maintenance timer

Nothing to do with OpenClaw, so a plain systemd --user timer:

```bash
cp scripts/autobuild.sh ~/.local/bin/gamereg-autobuild.sh
chmod +x ~/.local/bin/gamereg-autobuild.sh
mkdir -p ~/.config/systemd/user
cp scripts/gamereg-autobuild.service scripts/gamereg-autobuild.timer ~/.config/systemd/user/
# edit ExecStart and GAMEREG_VAULT in the .service if the defaults do not match
systemctl --user daemon-reload
systemctl --user enable --now gamereg-autobuild.timer
```

Push is a no-op, not an error, until the vault has a `git remote`.

### 10. Vendor Quartz for the site (optional)

Only if the vault builds the `quartz` target. `gamereg build quartz` emits
`quartz/content/` and seeds `quartz/quartz.config.yaml` and never runs Quartz
(invariant 8), so nothing so far makes a site exist.

```bash
gamereg build quartz                             # seeds config and content
scripts/vendor-quartz.sh --clone --tag v5.0.0    # or --source ~/quartz-src
```

The script copies a Quartz checkout's framework files into `<vault>/quartz/`
without touching `content/` or `quartz.config.yaml`, merges `package.json`
rather than overwriting it (a theme installed by hand survives a rerun), seeds
`wrangler.jsonc` once, and verifies with `npm install && npx quartz build`.
Rerunning is how the framework gets upgraded. This is one verified path, not an
answer to how the site is hosted.

### 11. Reaction tokens (optional, inert)

`workspace/REACTIONS.md` ships with an emoji per row and no stickers, and step
5 already copied it. Both gateway switches
(`channels.telegram.actions.sticker`, `.reactions` plus `reactionLevel`) are
off by default in `openclaw.example.json5`. See *Reactions are a second call*
below before filling anything in.

## Decisions

### Exit codes are control flow, and the gateway does not know that

The gateway prints a failed-exec warning for any non-zero exit. In `gamereg`,
codes 3 (ambiguous) and 4 (not_found) are how the CLI answers a question — so
a flow working exactly as designed puts a warning on the user's screen.

Nothing in `gamereg` changes for this: the exit codes are its contract
(`02-cli.md`) and returning 0 for "not found" would be worse for every other
caller. The prompt avoids the collision instead — `search` never exits
non-zero and answers both "is it on record" and "what does the catalog have",
so a `start` on a possibly-new game leads with it.

### Why amend/revoke are not behind an approval gate

They sit on the allowlist like every other `gamereg` command, and the
confirmation is conversational (`reference/corrections.md`): state what will
change, wait for an unambiguous yes, then run it.

The alternative — excluding them so either falls to an approval prompt — was
built and abandoned. The prompt itself is the problem: it shows raw command
text and a UUID, and with routing incomplete the agent will invent a
plausible-looking `/approve <uuid>` rather than report that it is stuck.
Fixing that display is not in this repo's control.

**What that costs, stated plainly:** nothing now stops a wrong `amend` if the
model misjudges its own conversation. The append-only log means nothing is
destroyed — a bad amend is one more amend from fixed — but it is no longer
*impossible* for the agent to run one without a real yes, only *against
instructions*.

To take the harder guarantee instead, all four of: exclude `amend`/`revoke`
from `approvals.example.json`, set `tools.exec.mode: "ask"`, configure
`approvals.exec: {enabled: true, mode: "session"}`, and give
`channels.telegram.execApprovals` an explicit `approvers` list. Any one
missing and a gated command fails with no way to approve it.

### The button shape: a raw `value`, never `action: {type: "callback"}`

Three button shapes exist and **only one delivers a tap to the agent on this
version** (`openclaw 2026.7.1-2`):

| Button | `callback_data` sent | Tap arrives? |
|---|---|---|
| `action: {type:"callback", value}` | `tgcb1:<checksum>:<value>` | **No** |
| `action: {type:"command", command:"/x"}` | `tgcmd:/x` | Yes, as `/x` |
| `value` alone, no `action` | the value, raw | Yes, as `callback_data: <value>` |

The dead one is the shape both the docs and the gateway's own injected prompt
push you toward, which is why `AGENTS.md` names it and overrules it rather than
merely showing the right one. Traced: every `callback` button's data is wrapped
in an opaque checksummed envelope unconditionally
(`buildTelegramOpaqueCallbackData`), and the inbound handler returns early on
any envelope it does not recognize as one of a few built-ins — *before* the
code that turns a tap into a message for the agent. `answerCallbackQuery` still
runs, so the button stops spinning and nothing looks broken.

Four more facts, all read out of the installed package rather than guessed:

- **64 bytes, and failure is silent.** Past the limit,
  `sanitizeTelegramCallbackData` returns undefined and the button is dropped
  from the row. The message sends with fewer buttons and nothing logs it. A ref
  or an id fits; a title does not.
- **Rows hold three buttons**, and `buttons` is an array *of rows*.
- **Buttons attach only to the first media item** of a multi-media send
  (`deliverMediaReply`: `isFirstMedia && replyMarkup && !followUpText`), so one
  message carrying several covers would strand all but the first with no
  button. That is why a candidate menu is one message per candidate.
- **A tap comes back carrying the media of the message the button was on.**
  `buildSyntheticTextMessage` spreads the base message and overrides only the
  text, so the `photo` array survives and a tap looks exactly like a photo the
  user just sent. Left unhandled this would file a candidate's cover art as the
  user's own — or, classified as a `box` photo, mark the run `--form physical`:
  a claim about how someone played, invented from a tap.

`style` works without `richMessages`; only button *width* needs it. An unstyled
button renders as barely-visible text.

If this is ever revisited, try OpenClaw's `beta` dist-tag before assuming a fix
has to wait on `latest` — it has run well ahead of it. A working `callback`
branch would also lift the 64-byte ceiling, since the opaque envelope is what
used to buy arbitrary length.

**The probe worth keeping**, because it separates "the channel cannot render
buttons" from "the agent built the payload wrong" in one shot:

```bash
openclaw message send --channel telegram --target "telegram:<id>" \
  --message "probe" \
  --presentation '{"blocks":[{"type":"buttons","buttons":[
     {"label":"A","value":"probe-a"},{"label":"B","value":"probe-b"}]}]}'
grep -l "callback_data: probe-a" ~/.openclaw/agents/*/sessions/*.jsonl
```

### A check-in has no buttons, and therefore one sender

The exits are typed: "pausa", "encerrei às 22h", or nothing at all. That is a
usability call before it is an implementation one — an unanswered check-in
stays on screen, and an hour later its buttons still look tappable while the
session they name may be long closed. A tap that cannot work is worse than no
tap.

It also settles the delivery question by removing it. Buttons were the only
reason the agent used the `message` tool on a check-in, and with two senders
in play — `--deliver` *and* the tool — every check-in arrived **twice**:
identical text, same minute, one copy with buttons and one without. Nothing
generated it twice; the model narrated alongside its tool call, as models do,
and `--deliver` delivered the narration. (`NO_REPLY` does not save you: it is
matched per payload against `^NO_REPLY$`, and the turn produced two.)

Now the wake never asks for the message tool, so `--deliver` is the only path
a check-in has. `GAMEREG_CHECKIN_CHANNEL`/`_TO` still become
`--reply-channel`/`--reply-to` when set: they no longer pick a mode, they make
the routing explicit rather than inferred.

**What was tried first, so it is not rebuilt:** keeping the buttons and
teaching the agent to strip them once the question went stale. Three versions
— in the check-in reference, then in the always-loaded card, then generalised
to any flow — and all three failed the same way. Measured rather than
assumed: adding 1000 characters to the deployed `AGENTS.md` grew the system
prompt by 991, so the rule was reaching the model and the model was not
applying it. It reliably strips a button it created in the same turn; it does
not do bookkeeping on a message from an earlier one while working on something
else. Moving the send into `checkin.sh` would have worked, at the cost of
giving a stateless wrapper state and depending on channel-specific edit
semantics. Dropping the buttons costs nothing and removes the class.

### Maintenance moved off the agent, onto `scripts/autobuild.sh`

`autobuild.sh` reads `git status` in the vault and, when dirty, runs
`enrich --missing --covers`, then `build`, then commits and pushes. It keeps no
state beyond the repository, so a missed or overlapping tick just finds more to
do next time. The agent runs `gamereg build` only when the user asks for it in
the moment.

The agent used to fire both as backgrounded `exec` calls, which had a real bug:
`build` invoked while another is writing exits 5 immediately rather than
queuing, so two session closes near each other silently lost the second build.

**A self-backgrounding flag on `gamereg` was considered and rejected.** It runs
into invariant 5 (`00-architecture.md`): `enrich` is the one command that
reaches the network, kept synchronous precisely so a caller has one observable
point where "did this succeed" is knowable. A forking `enrich` returns before
that point exists. `autobuild.sh` keeps every `gamereg` call synchronous and
backgrounds only itself.

With no background `exec` calls left, `tools.exec.notifyOnExit` no longer needs
watching — a backgrounded call finishing could otherwise wake the agent to
comment on something nobody asked about.

### Reactions are a second call, and ship inert

A sticker is a **channel action**, not a presentation block:
`MessagePresentationBlock` is `text | context | divider | buttons | select`,
with no sticker or reaction member, so a reaction never rides along with a
reply the way a keyboard does.

- `action: "sendSticker"`, `to`, `fileId` — gated by
  `channels.telegram.actions.sticker`; unset, it throws loudly.
- `action: "react"`, `messageId`, `emoji` — gated twice, by
  `channels.telegram.actions.reactions` *and* `reactionLevel` above `"off"`;
  a miss returns `{ok: false, reason: "disabled"}` rather than an error.

**A `file_id` belongs to a bot, not to a sticker.** Send the sticker to your
bot from your own account and read the id off the update; the same sticker
under a different token is a different id, so the table does not survive
replacing the bot. No artwork ships here and none will — the sticker set is per
installation.

**The five tokens are identifiers and are never translated.** `filed`,
`approved`, `archived`, `pending`, `puzzled`. Four collide by name with the
register's localized vocabulary, which is prose from `gamereg vocab` that the
agent says out loud; a translated token matches no row and the reaction
silently does not happen.

## Traps

Symptom first: these are indexed by what you will actually see. The story of
how each was found is in `CLAUDE.md`.

**The agent follows the old procedure after an image upgrade.** `AGENTS.md`
used to be seeded like a persona file and was therefore never replaced. It is
code now and is redeployed on every boot; an image from before that leaves it
untouched. Check with a phrase unique to the new text, and remember a
conversation already under way keeps the copy it loaded — `/reset` starts a
fresh one.

**The agent says it recorded something, and the register does not have it.**
Check `amend` first. A patch key the target event's type does not carry used to
be merged, read by nobody and reported as a success — `--set rating=9` on a
`run.open`, whose rating the fold takes from the `run.close` instead. Refused at
exit 2 since, naming the fields that type does carry. A run has two correctable
events, `run_open_event_id` and `run_close_event_id`, both on `gamereg status`,
and the field decides which one. Anything filed before the refusal is inert: the
fold already ignored it, so nothing needs undoing.

**The agent behaves like an older version of the code.** `npm link` links
`dist/`, so a `git pull` changes nothing until `npm run build`. Rebuild, then
confirm with a command that only exists in the new code.

**Two accounts disagree about the same register.** A per-user npm prefix gives
each account its own copy of `gamereg`. Install once with `sudo npm install -g`
so every user resolves the same binary.

**The agent answers with no `gamereg` knowledge at all.** The skill directory
is a symlink. OpenClaw resolves the real path of anything under
`workspace/skills/` and refuses what escapes the configured root, which a repo
checkout always does. Use real copies. The log says
`Skipping escaped skill path outside its configured root: reason=symlink-escape`.

**A prompt fix does not take, and the agent repeats what you just corrected.**
Prompt files are read into a session at its start; restarting the gateway does
not change a session already under way. Confirm by grepping the transcript
(`~/.openclaw/agents/<agent>/sessions/*.jsonl`) for a phrase unique to the new
text. `/reset` in the chat starts a fresh session.

**`EACCES: permission denied, mkdir '<vault>/data'`, while the same command
over SSH works.** A vault group added after the gateway first started:
supplementary groups resolve at login, and `systemctl --user restart <service>`
restarts within the existing session.

```bash
id                                                      # your groups
PID=$(systemctl --user show -p MainPID --value openclaw-gateway.service)
grep ^Groups /proc/$PID/status                          # the gateway's
sudo systemctl restart user@<your-uid>.service          # interrupts all user units
```

**The container will not boot after an OpenClaw upgrade, or boots and then
fails every message.** Two separate migrations, and the second is the quiet
one. A config key the old version wrote can stop being recognized, which kills
the boot-time `config patch`; and the exec allowlist moved from
`$STATE_DIR/exec-approvals.json` into `state/openclaw.sqlite`, where a legacy
file left in place raises `ExecApprovalsMigrationRequiredError` at runtime
while the gateway itself looks healthy. The entrypoint handles both. The rule
behind the second: **ask the installed CLI to write its own store
(`openclaw approvals set`) rather than writing the store's file** — a `cp`
hardcodes a format that is not yours.

**Every CLI client gets `token_mismatch` while the gateway is healthy.**
`gateway.auth.token` in the config and `$STATE_DIR/.gateway-token` disagree.
The file is the authority; the entrypoint restates it into the config on every
boot.

**The gateway restart-loops, and each boot passes the health check first.**
Memory. It idles near its limit and restarts itself under its own
memory-pressure check. `GATEWAY_MEM_LIMIT` is `1g` and that is a floor — see
`docs/deploy-container.md` for the measurements.

**A cron job sends its own stdout to a chat.** A command job's `delivery.mode`
defaults to `announce`; pass `--no-deliver`. Delivery failing also marks the
run `status: "error"` even when the command exited 0. `checkin.sh` keeps stdout
empty on every path and puts diagnostics on stderr, where `openclaw cron runs`
shows them.

**Check-ins claim in the log to have come from a conversation.** A command job
inherits the gateway's environment, `GAMEREG_SOURCE=chat` included.
`checkin.sh` sets `cron` itself; `test/checkin-wrapper.test.ts` runs with
`chat` in the environment to keep it honest.

**`openclaw agent` refuses: "No target session selected".** There is no
implicit main session; pass `--agent`. Its `--help` line about omitting a value
is about the delivery channel, not the session.

**A check-in reaches a chat that is not yours.** A cron wake carries no
delivery routing, and the `message` tool fails open rather than closed — a bare
`telegram` resolves to `@telegram`, the public channel, and the send is stopped
only by the bot not being a member. Pass `--reply-channel` and `--reply-to`
(hence `GAMEREG_CHECKIN_TO`); `reference/checkins.md` forbids the agent naming
a target at all.

**A check-in arrives in the wrong language.** A wake has nothing written to
infer from. `checkin.sh` reads `gamereg vocab --json`'s `locale` and states it
as a fact — a tag, not a phrasing.

**A test check-in files a break on a real session.** A scratch vault isolates
only the question: the wrapper reads `GAMEREG_VAULT` from its own environment,
the *agent* reads it from the gateway process. Test the answer half against the
real vault on a session you are willing to have a break filed against, or
repoint the gateway and restart it.

**A candidate menu arrives out of order.** Messages sent in one turn race, and
OpenClaw's per-chat ordering queue is built only for group chats
(`chatId < 0`); a DM skips it. The only lever is how many sends the model puts
in one turn — hence covers as a batch, closing line second.

**A `message` call reports success and the message is wrong.** An argument not
in the tool's schema is accepted and dropped without a word. Settle what a tool
accepts from the agent's own trajectory file
(`~/.openclaw/agents/<agent>/sessions/*.trajectory.jsonl`), which records the
definitions it was handed; it beats both the docs and the injected prompt.

**`amend` exits 2.** `--reason` is required.

## Smoke test

From your phone, no terminal, in whatever language you actually use. The bot's
words come from `gamereg vocab` in that language; an English term like "filed"
landing mid-sentence means the skill did not deploy as edited.

1. "starting hollow knight" → a session opens, and you are *not* asked for a platform
2. Send a photo mid-session → it is held for the close
3. A voice note: "just stopped, got to the Watcher Knights" → the session closes, the note is your words, the platform question arrives *now*
4. A title matching several games → inline buttons, one tap, no retyping
5. "done, 9 out of 10, hard" → the run closes
6. Accept a drafted verdict → filed as written
7. "how many hours did I play this year?" → a number that came from SQL

On a fresh vault, step 7 also exercises `data/log.db` not existing yet: the
agent should run `gamereg build` itself and retry rather than reporting a dead
end.

Then from a terminal: `gamereg build`, and check the notes regenerate carrying
`source: "chat"`.

Then the check-in — the one step that cannot start from the phone. Preview
costs nothing; the real run must use the **real vault**, on a session you are
willing to have a break filed against:

```bash
~/.openclaw/checkin.sh --dry-run --at "2026-08-23 09:00"
~/.openclaw/checkin.sh
```

It should arrive **once**, name the game and how long it has been open, and
read as an offer rather than a verdict. Two copies, one with buttons and one
without, means both delivery paths are live. Tap "taking a break", then read
the log for three events: a `session.checkin` with `source: "cron"`, a
`break.open`, and an `event.amend` moving the outcome to `break_started`. The
last is the one worth checking — it is the agent's only bookkeeping, it needs
an id nothing handed it, and it is what gets skipped when anything upstream
went wrong.

Last: message the bot from another account and confirm nothing happens.

## What is not here

**No sticker artwork, and none is coming.** The tokens are wired end to end and
every sticker cell is empty, which is the finished state for this repository.

**No second persona.** Gaby exists only inside `workspace/SOUL.md` and
`PERSONAS.md`; her counter stays closed until board games land, so the fiction
and the roadmap say the same thing.
