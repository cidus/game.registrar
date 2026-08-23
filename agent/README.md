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
checkin.sh              the hourly check-in poll, run by cron on the gateway host
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

**`npm link` links the built output, not the source.** `gamereg` on `PATH`
resolves to `dist/src/cli/main.js`, so a `git pull` changes nothing the agent
runs until `npm run build`. This is not theoretical: this deployment spent days
serving a `dist/` four days older than the checkout it came from, and the
symptom was subtle — commands behaved like an earlier version rather than
failing. After changing anything under `src/`, rebuild, then confirm with a
command that only exists in the new code.

**Install it once, for everyone.** `sudo npm install -g` puts it in
`/usr/lib/node_modules` with the executable in `/usr/bin`, which every user on
the host resolves the same way. A per-user npm prefix gives each account its own
copy, and two copies of the same tool pointed at one append-only log is a
problem you find out about later, from behaviour you cannot explain.

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

`/setuserpic` sets the avatar, which is the only place the persona is visible
before the agent says anything. The image is not in this repository and the
reasoning is in `PERSONAS.md`, along with the prompts that generated it — with
no image committed, those prompts are what reproduces one.

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

### Exit codes are control flow here, and the gateway does not know that

The gateway prints a failed-exec warning to the user for any non-zero exit. In
`gamereg`, codes 3 (ambiguous) and 4 (not_found) are not failures — they are how
the CLI answers a question, and the agent is built around them. The result is a
warning on the user's screen in the middle of a flow that is working exactly as
designed: `start` on a game not yet on record exits 4 every time, because
`start` performs no network I/O and the catalog has not been consulted yet.

Nothing in `gamereg` should change for this — the exit codes are its contract
(02-cli.md) and a CLI that returned 0 for "not found" would be worse for every
other caller. The skill avoids the collision instead: `search` never exits
non-zero, answers both "is it on record" and "what does the catalog have", and
is what a start now leads with when the game may be new.

### 5. Install what the agent reads

Two copies, and both are required. The skill is the procedure; the workspace
files are the persona and the standing orders. Install only the first and the
agent knows how to drive `gamereg` while sounding like nobody in particular.

```bash
cp -R agent/skills/gamereg ~/.openclaw/workspace/skills/
cp agent/workspace/*.md ~/.openclaw/workspace/
```

`PERSONAS.md` is deliberately not among them — it sits at `agent/` root
because it is a design document for whoever draws a character, and the agent
has no use for it.

**Real copies, not symlinks — tried and reverted.** A symlinked
`skills/gamereg` fails outright, silently from the user's side: OpenClaw's
skill loader resolves the real path of anything under
`~/.openclaw/workspace/skills/` and refuses it if that path escapes the
configured root, which a repo checkout outside `~/.openclaw` always does. The
agent just answers with no `gamereg` knowledge at all — reads as "it lost its
skills, and the personality's off too," since a Registrar improvising without
`SKILL.md`/`reference/cli.md` doesn't sound like one. It's in the gateway's own
log the moment it happens:

```
[skills] Skipping escaped skill path outside its configured root: reason=symlink-escape
requested=~/.openclaw/workspace/skills/gamereg resolved=<repo>/agent/skills/gamereg
```

The workspace `.md` files themselves have no such guard (their loader carries
no realpath check) — only the skill tripped this — but the whole point was one
redeploy step, not a mixed one, so both went back to plain copies.

**A conversation already under way keeps the copy it loaded.** These are read
into a session once, at its start, and restarting the gateway does not change
that: the transcript, with the old text inside it, is what the model keeps
reading. `/reset` in the chat starts a fresh one.

This failure does not look like a stale file. It looks like the fix not working
— the agent repeats the exact behaviour you just corrected, in a session where
the correction was never present. Twice here the giveaway was the same: `grep`
the session transcript for a phrase unique to the new text and count zero.
Transcripts are in `~/.openclaw/agents/<agent>/sessions/*.jsonl`, and reading
them is the fastest way to tell a bad instruction from an unread one.

### 6. Restrict what it may run

Four parts, and all four are required — any one missing and either nothing
is gated, or a gated command just fails outright with no way to approve it.

**The policy**, from step 3: `tools.exec.security: "allowlist"` and
`tools.exec.ask: "off"`. Skip `security` and the default is `"full"` —
unrestricted shell, allowlist file or not. Confirm what's actually in
effect:

```bash
openclaw approvals get
```

**`ask` moved from `"on-miss"` to `"off"` after watching it fire for real,
twice.** Both times the agent improvised a chained command it shouldn't have
(a `query --sql ... 2>&1 || gamereg --help`-shaped guess, from the same "let
me check something first" impulse — see `SKILL.md`'s *Starting a session*),
and both times the result was the same: an approval prompt in Telegram that
nobody asked for, that took anywhere from ~9 to ~300 seconds to resolve by
denying it, for a command the user never wanted to run in the first place.
Read `requiresExecApproval` in the installed package
(`exec-approvals-BIKWP8_V.js:835-839`): with `ask: "off"`,
`hasGatewayAllowlistMiss` still throws (`bash-tools-DHyGpWCr.js:1391`,
`"exec denied: allowlist miss"`) for anything outside the allowlist — the
command still gets refused, just immediately, as a plain tool error the agent
reads and recovers from on its own, with nothing sent to the user and nothing
to wait on. The whole point of the allowlist was never "ask a human about
edge cases" — this agent has exactly one thing it's allowed to run, so a miss
is always a mistake to recover from, never a legitimate request waiting on a
decision. The approval-routing setup below (`approvals.exec`, Telegram's
`execApprovals`) is now dormant with `ask: "off"` — left in place and
documented in case a future change reintroduces a real approval path, not
because it still does anything today.

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

**Confirmed live:** the smoke test's voice-note step — closing a session by
speaking, not typing — has been run against this deployment. A session
closed correctly from a transcribed note, with the platform question
arriving afterward exactly as text-driven closes already did.

`tools.media.audio` transcribes voice notes before the CLI sees anything.
`gamereg` never touches audio and must never be asked to.

Hosted transcription is better on pt-BR out of the box; local Whisper keeps the
audio on the machine and costs nothing per minute. Try both with the titles you
actually say out loud — that, and not a benchmark, is what decides it.

Either way, transcribed titles are unreliable. That is what the alias table is
for: the user corrects a mangled title once, with `gamereg alias`, and the
register recognizes it from then on.

### Inline buttons, and the shape the model is actually told to use

`capabilities.inlineButtons` in `openclaw.example.json5` is a **channel**
capability, not an exit-code-3 feature. Anything the agent asks can be a button;
code 3 is only the case that motivated turning it on.

**The gateway's own system prompt is wrong for this version, and the tool schema
proves it.** The `message` tool has no `buttons` property at all — its arguments
are `channel`, `target`, `message`, `media`, `presentation`, `delivery` and the
rest, with buttons living inside `presentation`. An argument that is not in the
schema is accepted and dropped without a word, which is why three separate
attempts sent a question with no way to answer it and reported success each
time.

The schema is readable without unpacking anything: the agent's own trajectory
file records the tool definitions it was given
(`~/.openclaw/agents/<agent>/sessions/*.trajectory.jsonl`). That is the fastest
way to settle what a tool actually accepts, and it beats both the docs and the
prompt, because it is what the model was handed.

With the capability on, the gateway injects this into the model's prompt:

> Inline buttons supported. Use `action=send` with
> `buttons=[[{text,callback_data,style?}]]`; `style` can be `primary`,
> `success`, or `danger`.

The agent followed it, twice, and the message arrived with no buttons both
times. The documentation at docs.openclaw.ai/channels/telegram describes no such
flattened form: buttons go inside the message's `presentation`, as a
`blocks: [{ type: "buttons", buttons: [...] }]` entry, and each button is
`{ label, action: { type: "callback", value }, style? }`. That is the shape
`SKILL.md` uses.

Add it to the tally this file keeps, at the top: the injected hint is upstream
guidance that contradicts the very schema the same gateway ships, and it is
repeated twice in the model's context against one mention in SKILL.md — which is
why the skill now names it and overrules it explicitly rather than merely
showing the right shape. When it is off,
the gateway injects the opposite, naming the setting to turn on — which is why
an agent that cannot show buttons has no excuse for pretending it can.

Two details worth having in writing:

- **Rows hold three buttons** (`TELEGRAM_INTERACTIVE_ROW_SIZE`), and `buttons`
  is an array *of rows*, so a yes/no pair is `[[{…},{…}]]`.
- **`SKILL.md` used to document a different dialect** — `label` plus
  `action: { type: "callback", value }`. That is not broken: the payload
  normalizer reads `record.label ?? record.text` and
  `record.callbackData ?? record.callback_data`, so both arrive. It was still
  changed to match the gateway's own wording, because two dialects competing in
  one context is a coin flip for the model, and only one of them is guaranteed
  to survive an upgrade.

Long values are safe: `buildTelegramOpaqueCallbackData` maps them past
Telegram's 64-byte `callback_data` limit, so a `callback_data` that names the
action in full — which `SKILL.md` requires, so a stale tap cannot read as
consent — does not need shortening.

**The documented shape is confirmed rendering on this deployment**, sent from the
CLI, which settles the channel and the payload:

```bash
openclaw message send --channel telegram --target "telegram:<id>" \
  --message "test" \
  --presentation '{"blocks":[{"type":"buttons","buttons":[
     {"label":"A","action":{"type":"callback","value":"a"},"style":"success"},
     {"label":"B","action":{"type":"callback","value":"b"},"style":"danger"}]}]}'
```

Keep that command. It separates "the channel cannot render buttons" from "the
agent built the payload wrong" in one shot, and getting those two confused cost
several rounds here — including one where the test itself was malformed and its
negative result was believed.

**Button labels: the title fits on a lone button, the number is for a row.**
Live testing on Sifu (not even a long title) showed the channel clipping it
mid-word — but that was three buttons sharing a row. A candidate sent as its
own photo message has the full width to itself, and `richMessages` below widens
it further, so `SKILL.md`'s cover-photo variant labels the button with the
title. The no-cover variant still labels with the number: three to a row is
where the clipping was measured, and there is no cover above to carry the name.
Digit emoji were considered for that label and dropped — `SKILL.md` is
ASCII-only by `test/agent-skill.test.ts`, and a plain `"1"` needs no exception.

**`style` works without `richMessages`; only the width needs it.** Both were
sent side by side, one with the flag off and one on, and `primary`/`success`/
`danger` rendered coloured either way. Worth knowing before turning on a flag
that also changes table and media rendering — `channels.telegram.richMessages`
in `openclaw.example.json5` carries the reasoning. An unstyled button renders
as barely-visible text, which is why `SKILL.md` requires a style on whichever
button performs the action.

**Messages sent in one agent turn race, and a DM has nothing to order them.**
A candidate menu arrived with its closing "tap one" line sitting in the middle
of the covers. The obvious guess is Telegram latency; the transcript says
otherwise in one line — the model emitted nine `message` calls in a single
turn and all nine results came back inside 8ms of each other, with Telegram
handing out ids 366-374 in arrival order.

Nothing in config fixes it. OpenClaw does have a per-chat ordering queue
(`GroupFairQueue`, `send-BgA996pw.js:134`), but it is only built when
`resolveGroupChatKey` returns a key, and that returns one only for
`chatId < 0` — group chats. A DM's positive id skips the queue entirely and
goes straight to the throttler. The only lever is how many calls the model puts
in one turn, so `SKILL.md` sends the covers as a batch and the closing line in
a second step, after their results land.

**`presentation`'s buttons only attach to the first media item in a multi-media
send.** Read straight out of the installed package
(`openclaw/dist/delivery-BzuQz4xo.js`, `deliverMediaReply`):

```js
const shouldAttachButtonsToMedia = isFirstMedia && params.replyMarkup && !followUpText
```

So a single `message` call carrying several candidates' cover photos plus one
button per candidate would strand every photo after the first with no button
at all — not a smaller version of the desired menu, a broken one. `SKILL.md`'s
cover-photo variant of *Candidates* sends one `message` per candidate instead
(one photo, one caption, one button) specifically because of this.

**Confirmed rendering with a real send.** There is no `--caption` flag on the
CLI (`openclaw message send --help` — the underlying tool schema has one, but
the CLI does not expose it); `--message` is what becomes the caption when
paired with `--media`:

```bash
openclaw message send --channel telegram --target "telegram:<id>" \
  --message "Sifu: Arenas (2023)" \
  --media "https://images.igdb.com/igdb/image/upload/t_cover_big/co67x0.jpg" \
  --presentation '{"blocks":[{"type":"buttons","buttons":[
     {"label":"Choose this one","action":{"type":"callback","value":"igdb:240171"}}]}]}'
```

Sent and confirmed on this deployment: photo, caption, one tappable button
underneath, exactly as `SKILL.md` described it — **but that only confirms the
button renders.** It does not confirm a tap does anything, and on this
deployment, right now, it does not.

**A `callback` button's tap never reaches the agent — but that is one branch
of three, and the other two work.** This started as "buttons are broken" and
that was too broad: `toTelegramCallbackData`
(`openclaw/dist/button-types-B2h0t2EL.js:30`) decides the wire format from the
button's own shape, and only one of the three is dead:

| Button | `callback_data` sent | Tap arrives? |
|---|---|---|
| `action: {type:"callback", value}` | `tgcb1:<checksum>:<value>` | **No** |
| `action: {type:"command", command:"/x"}` | `tgcmd:/x` | Yes, as `/x` |
| `value` alone, no `action` | the value, raw | Yes, as `callback_data: <value>` |

The dead one was found first because it is the shape both the docs and the
gateway's injected prompt push you toward. Confirmed twice then — one photo
message, one plain-text one, both tapped, and the gateway log
(`journalctl --user -u openclaw-gateway`) showing nothing after either:
no new `Inbound message` line, no mention of `callback` anywhere.
`answerCallbackQuery` still runs, so the button stops "loading" and nothing
*looks* broken from the client — it silently does nothing.

**The raw-`value` shape is confirmed working on this deployment.** Sent from
the CLI, tapped on a real phone, and the value arrived as an ordinary user
message in the agent's own transcript:

```bash
openclaw message send --channel telegram --target "telegram:<id>" \
  --message "probe" \
  --presentation '{"blocks":[{"type":"buttons","buttons":[
     {"label":"A","value":"probe-a"},{"label":"B","value":"probe-b"}]}]}'
grep -l "callback_data: probe-a" ~/.openclaw/agents/*/sessions/*.jsonl
```

```json
{"role":"user","content":"callback_data: probe-a","__openclaw":{"senderIsOwner":true}}
```

**A tap comes back carrying the media of the message the button was on.**
`buildSyntheticTextMessage` (`telegram-ingress-spool-Dd3cDhXe.js:2085`) spreads
the whole base message and overrides only `text`, `caption`, `caption_entities`
and `entities` — the `photo` array survives:

```js
const buildSyntheticTextMessage = (params) => ({
  ...params.base, text: params.text, caption: void 0, ...
});
```

Since `base` is the message the button lives on, tapping a candidate's button
hands the agent that candidate's cover art, indistinguishable from a photo the
user just sent. Seen live: the agent spent a failed tool call and two turns of
reasoning before concluding on its own that the image was its own. It happened
to conclude right. Had it classified the cover as a `box` photo instead,
`SKILL.md`'s *Photos* rules would have marked the run `--form physical` — a
claim about how someone played, invented from a tap. `SKILL.md` now says
outright that media on a `callback_data:` message is furniture from its own
message.

(The reference itself does not resolve — `Unsupported image reference:
telegram:file/…` — because the callback path passes `allMedia: []`, so nothing
downloads the file. That is what made the failure loud rather than silent, and
it is luck, not a safeguard.)

Two things that shape stakes on, both read out of the package rather than
guessed:

- **64 bytes, and failure is silent.** `sanitizeTelegramCallbackData` returns
  `undefined` past `TELEGRAM_CALLBACK_DATA_MAX_BYTES`, and
  `toTelegramInlineButton` then drops that button from the row. The message
  still sends, with fewer buttons than were built, and nothing logs it. A ref
  or an id fits; a title does not. The opaque `tgcb1:` envelope is what used
  to buy arbitrary length, and it is exactly the branch that no longer
  delivers — so on the working path the limit is real.
- **The synthesized message is not a user bubble.** OpenClaw builds it
  server-side (`buildSyntheticTextMessage`), so a tap leaves nothing in the
  chat showing what the user answered. This is not Telegram's reply keyboard:
  `ReplyKeyboardMarkup` appears nowhere in the package, only `inline_keyboard`.

The tool's own schema allows it — `presentationButtonSchema`
(`openclaw-tools-KulZ1cdH.js:5328`) requires `label` and makes both `action`
and `value` optional — so the agent can build this shape, not just the CLI.

Traced into the installed package for the dead branch
(`openclaw@2026.7.1-2`, the current version — `npm view openclaw version`
confirms no update fixes this):

- Every `action: {type: "callback", value}` button gets its `callback_data`
  wrapped in an opaque, checksummed envelope on the way out, unconditionally
  — not only for values over Telegram's 64-byte limit
  (`button-types-B2h0t2EL.js:37`, `buildTelegramOpaqueCallbackData`).
- The inbound `callback_query` handler
  (`telegram-ingress-spool-Dd3cDhXe.js:3483`) decodes that envelope, and if
  the decoded value doesn't match one of a handful of *specific* built-in
  cases (exec approval, a managed multi/single-select, command pagination,
  the `/model` picker, a registered plugin's own interactive component), it
  hits this and returns, doing nothing further:

  ```js
  if (opaqueCallbackData) return;  // telegram-ingress-spool-Dd3cDhXe.js:3781
  ```

  The code that turns a tap into a synthetic `callback_data: <value>`
  message for the agent — `buildSyntheticTextMessage` /
  `processMessageWithReplyChain`, around line 3987 — sits **after** that
  return. An enveloped button never gets there; an unenveloped one does, which
  is the whole difference between the two shapes.

**Consequence for `SKILL.md`:** *Confirmations* is the one place the button
shape is written down, and it spells out `{label, value}` with no `action`,
because the shape the gateway's own injected prompt asks for is the dead one.
*Candidates*, the session-switch offer, the cover-replace offer, the EXIF
`captured_at` correction and `amend`/`revoke`'s confirmation all carry buttons
again — and all stay answerable in plain text, since a tap leaves nothing on
screen and a typed reply has to keep working.

**Not a new regression on this machine — the installed version has been
"latest" for over a month.** `npm view openclaw time --json` puts
`2026.7.1-2`'s publish date at 2026-07-18; it was only installed on this
machine on 2026-08-19. Whether the bug is older than that release isn't
something this repo can answer (that's `openclaw`'s own history, not
`gamereg`'s). What is worth knowing: `npm view openclaw dist-tags` shows a
`beta` channel well ahead of `latest` (`2026.8.1-beta.2`, published
2026-08-15) — untested here, but the first thing to try if this ever gets
revisited, before assuming a fix requires waiting on `latest`.

That upgrade is worth watching for a second reason now: if the `callback`
branch starts delivering, its opaque envelope lifts the 64-byte ceiling the
raw-`value` shape lives under. Nothing in `SKILL.md` needs it today — refs and
ids fit — so this is a note about headroom, not a pending fix.

### Background `enrich`/`build`, and the one config knob left untouched

`SKILL.md`'s *Background maintenance* has the agent fire `gamereg enrich`
after a new game and `gamereg build` after a session closes, both silent and
unreported. The mechanism is real, not just a prompt instruction — the `exec`
tool's schema (`bash-tools.schemas-DSAIk_o8.js` in the installed package) has
a genuine `background: Type.Boolean()` param ("Run in background immediately"),
gated by `tools.exec.allowBackground` (default `true`, unset in this
deployment's `openclaw.json`, so it's on).

**Left open, deliberately: `tools.exec.notifyOnExit`.** Its own description
(`schema-DRyO1XBt.js`): "When true (default), backgrounded exec sessions on
exit... enqueue a system event and request a heartbeat." Default is `true`
here too. A `--json`-emitting command like `enrich`/`build` never has empty
output, so `notifyOnExitEmptySuccess`'s default-`false` suppression (for
empty-output successes) does not apply to it — meaning a background
`enrich`/`build` finishing, even successfully, can still enqueue a heartbeat
and wake the agent, which could then decide to say something about it
unprompted. Turning `tools.exec.notifyOnExit` to `false` would close that gap,
but that's a live config edit, and it was deliberately left alone rather than
changed alongside a behavior nobody has watched run yet — try the background
calls first, see whether an unprompted comment about a completed `enrich`/
`build` actually shows up, and only then decide whether the config is worth
touching.

### 8. Wire the check-in poll

`agent/checkin.sh` is the gateway's half of the check-in machinery
(`docs/spec/05-agent.md`, *Check-ins*). It runs `gamereg checkin --expire` and
`gamereg due --json`, exits silently when nothing is due, and otherwise wakes
the agent with the rows and files a `snoozed` check-in for each — in that order.
It is the gateway's file, not the agent's: the agent still executes one
allowlisted binary and still writes nothing itself.

Copy it somewhere stable on this host and register it as an hourly **command**
job — the binary with no model attached, which is what makes an empty poll free:

```bash
cp agent/checkin.sh ~/.openclaw/checkin.sh
openclaw cron add --name gamereg-checkin --every 1h --no-deliver \
  --command-env GAMEREG_VAULT=/opt/gamereg-vault \
  --command-env GAMEREG_CHECKIN_CHANNEL=telegram \
  --command-env GAMEREG_CHECKIN_TO=<your numeric chat id> \
  --command "$HOME/.openclaw/checkin.sh"
```

Before any of that, run it by hand. `--dry-run` performs nothing and prints the
message it would have sent, and `--at` evaluates as if it were another time —
the same flag the CLI takes, forwarded to every `gamereg` call the script makes:

```bash
GAMEREG_VAULT=/opt/gamereg-vault ~/.openclaw/checkin.sh --dry-run
GAMEREG_VAULT=/opt/gamereg-vault ~/.openclaw/checkin.sh --dry-run --at "2026-08-23 09:00"
```

Everything below was checked against the installed gateway
(`openclaw 2026.7.1-2`) by running it, not read out of its documentation. Most
of it contradicts what a reasonable reading would have assumed, and the last
three were only found by watching a real check-in go out.

**`--no-deliver` is not optional, and the default is the dangerous one.** A
command job's `delivery.mode` comes back as `announce` with `channel: "last"`
unless you pass `--no-deliver` — so a job registered without it sends the
wrapper's stdout to a chat as raw text. On this host the first probe was saved
by an unrelated refusal:

```
Refusing implicit isolated cron delivery: the target would be inherited from
the shared agent-main session bucket's last recipient, which is ambiguous
across conversations and can deliver to the wrong room
```

That refusal is not a safety net to rely on — it depends on the delivery target
being ambiguous, which it stops being the moment anything sets one. Note also
what it did to the run: the command exited 0 and the run was still recorded
`status: "error"`, because delivery failed. A run history full of red on a job
that worked is its own kind of broken. `checkin.sh` therefore keeps **stdout
empty on every path** and puts diagnostics on stderr, where
`openclaw cron runs --id <job>` still shows them.

**A command job inherits the gateway process's environment — `GAMEREG_SOURCE`
included.** A probe job printed `VAULT=[/opt/gamereg-vault] SOURCE=[chat]`. The
vault being inherited is convenient; `chat` being inherited is a trap, because
every check-in this poll files would then claim in the log to have come from a
conversation. `checkin.sh` sets `GAMEREG_SOURCE=cron` itself rather than
trusting what it was handed, and `test/checkin-wrapper.test.ts` runs with `chat`
in the environment for exactly that reason. The job is registered with
`--command-env GAMEREG_VAULT=...` anyway: inheritance is not a contract.

**The wake is `openclaw agent`, not a second cron job.** OpenClaw's automation
docs are right that a command job's output cannot trigger an agent turn, so the
wrapper has to raise the turn itself. The candidate written down here before
this was built — `openclaw cron add --at +0s --delete-after-run --message …` —
works, but it is the worse of the two: a one-shot agent job hits the same
"refusing implicit isolated cron delivery" wall and needs an explicit
`--channel` and `--to`, which would put a Telegram chat id inside a file that
phase 5 is supposed to generate. `openclaw agent --message-file <file>
--deliver`, with no session key at all, runs the turn in the agent's main
session and delivers over that session's own channel. No ids in the wrapper, and
the question lands in the same conversation the answer will arrive in — which is
the part that matters, since the reply has to reach an agent that knows what it
asked.

It is also synchronous, and that turns out to be the better failure mode: the
wrapper files the snoozes only after `openclaw agent` has returned successfully,
so a gateway that was down leaves the session eligible on the next tick instead
of silently in backoff.

**`openclaw cron run <id>` fires a job on demand, and works on a disabled one.**
That is how to test a registered job without waiting for the hour, and creating
the job with `--disabled --keep-after-run` first makes the whole loop
inspectable: run it, read `openclaw cron runs --id <job>`, then enable it.

**`openclaw agent` needs a selector; there is no implicit main session.** The
first live run failed outright with *"No target session selected. Use --agent
&lt;id&gt;, --session-key &lt;key&gt;, --session-id &lt;id&gt;, or --to
&lt;E.164&gt;"*. Its own `--help` says `(omit to use the main session channel)`,
which is about the delivery *channel* and reads, at a glance, like a statement
about the session. `checkin.sh` passes `--agent`, defaulting to `main` and
overridable with `OPENCLAW_AGENT`.

Worth noting what that failure did *right*: `openclaw agent` returned non-zero,
so the wrapper filed nothing, and the session was still due on the next run. The
ordering rule is not theoretical — it was exercised on the first attempt.

**A turn started by a poll carries no delivery routing, and the `message` tool
fails open.** This is the one that matters. In a turn started by an inbound
message the gateway puts the conversation's target in the model's context — the
phase-2 transcripts are full of `"target": "telegram:<chat id>"`. A cron wake has
no inbound message, so nothing is injected, and the agent reached for the only
plausible-looking value it had:

```
"target":"telegram"  →  chat_id=-1001005640892
403: Forbidden: bot is not a member of the channel chat
Input was: "telegram:@telegram"
```

`telegram` resolved to **`@telegram`, the public Telegram channel**. The send was
stopped by the bot not being a member of it, and by nothing else. A wrong target
here does not fail closed; it addresses a real chat and tries. Read that failure
as the near miss it is, not as an error message.

The fix is `--reply-channel` and `--reply-to` on `openclaw agent`: with them the
run carries its own delivery context, the `message` tool defaults to it, and the
agent names no target at all — confirmed by a second live run, `messageId 478`,
buttons and all. Which is why `GAMEREG_CHECKIN_TO` exists and why `SKILL.md`'s
*Check-ins* forbids setting `target` in as many words. Leave both unset and the
poll still works: the question arrives as the agent's own reply text, which
`--deliver` routes correctly on its own. What is lost is the buttons.

`break-start:<ulid>` and `close-session:<ulid>` come to 40 bytes, comfortably
inside the 64-byte `callback_data` ceiling, and rendered as sent.

**A throwaway vault does not isolate the answer half — only the question half.**
Found the hard way. The wrapper takes its vault from its own environment, so
pointing it at a scratch vault keeps `due` and `checkin` off the real register.
The *agent* does not: it takes `GAMEREG_VAULT` from the gateway process, which
is the live vault and nothing else. So a check-in raised from a scratch vault is
answered against the real one, and the tap that was meant to open a break on a
fictional Hollow Knight session opened a real one on whatever session the real
vault had open. Undone with `revoke`, which is what it is for — the `break.open`
was the last event in the log, so it came out clean and `doctor` came back with
no problems.

Two things worth keeping from that. The agent noticed by itself: it read the
result, saw the game did not match the one it had asked about, and ran
`gamereg open --json` to work out why — the boundary held, and the model was the
thing that caught it. And it was only possible because the two vaults disagreed;
inside one vault, a second open session makes `break start` exit 3 and list them
rather than pick, which is the whole point of that exit code.

To test the answer half honestly, raise the check-in against the real vault on a
session you are willing to have a break filed against, or point the gateway's own
`GAMEREG_VAULT` at the scratch vault for the duration and restart it.

**`break start` takes a target and the skill reference used to hide it.** The
same episode surfaced this: `reference/cli.md` documented `gamereg break start`
with no arguments, while the binary has taken `[query]` and `--id` all along.
`test/agent-skill.test.ts` checks that every flag the reference *names* exists;
it cannot check the other direction, so a capability the reference omits is
invisible to the agent no matter how long it has been there. Both `break`
subcommands are now written out with their target, and `SKILL.md`'s *Check-ins*
requires passing it: the wake names a `game_id`, and answering a check-in about
one session by asking which session is meant would be absurd.

**`--deliver` and the `message` tool are two delivery paths, and turning on both
sends every check-in twice.** The clearest symptom possible, and still not
obvious from inside a single run: each check-in arrived as two Telegram
messages, identical text, same minute, one with buttons and one without. Nothing
generated the text twice — the model narrated alongside its `message` tool call,
which is ordinary behaviour, and that narration is the sentence it had just
sent. `--deliver` then delivered it.

`NO_REPLY` does not save you here. It is a real OpenClaw sentinel — the
dispatcher logs *"exact NO_REPLY final payload was skipped before delivery"* —
but it is matched per payload, against `^NO_REPLY$`. The turn produced two
payloads, the narration and the sentinel; only the second was skipped.

So `checkin.sh` picks exactly one path by mode: with routing configured it drops
`--deliver` entirely and the `message` tool is the only sender; with no routing
it passes `--deliver` and forbids the message tool, which cannot reach the
conversation anyway. `test/checkin-wrapper.test.ts` asserts both directions,
because the failure is invisible in the run history and in the transcript alike
— the transcript shows one `message` send and a successful `messageId`, which is
exactly what a correct run looks like.

**`amend` requires `--reason`, and the skill did not say so.** The first real
answered check-in cost a wasted round trip to exit 2 before the agent added it.
Written down because it is the shape of mistake this file exists to catch: the
reference listed the flag, `SKILL.md`'s own worked example omitted it, and a
worked example is what gets copied. Both now carry it.

**A wake has no language to infer from, and the agent will go looking.** The
first successful check-in came out in English, to a user who talks to this bot
in Portuguese, after two `sessions_history` calls and two `memory_search` calls
spent trying to work it out. `SKILL.md`'s *Language* rule — reply in whatever
they wrote — has nothing to work with when nobody wrote anything. `checkin.sh`
therefore reads `gamereg vocab --json`'s `locale` and states it in the wake as a
fact. A tag, not a phrasing: the vocabulary itself still comes from the CLI.

### 9. Reaction tokens, and why this step does nothing yet

Optional, off, and shipped that way on purpose. `agent/workspace/REACTIONS.md`
is the mapping table and every one of its five rows is empty, so the Registrar
reacts with nothing until somebody puts a `file_id` in one. Step 5 already
copied the file; there is no further install step.

What this step is really for is the two things that are not obvious when you do
decide to fill it in.

**A sticker is a channel action, not a presentation block.** This was the open
question when the tokens were specified, and it is answered: on OpenClaw
2026.7.1-2 the presentation shape that carries inline buttons has no sticker or
reaction member at all. `MessagePresentationBlock` is `text | context | divider
| buttons | select` (`payload-vIEr566D.d.ts:111`), which is the same union the
buttons work in step 3 was written against. So a reaction never rides along with
a reply the way a keyboard does — it is a second `message` tool call, with its
own action:

- `action: "sendSticker"`, `to`, `fileId` — posts the sticker as its own
  message. Gated by `channels.telegram.actions.sticker`; with the switch unset
  the call throws "Telegram sticker actions are disabled"
  (`action-runtime-Cv7KsCc_.js:459`), which is at least a loud failure.
- `action: "react"`, `messageId`, `emoji` — attaches an emoji to an existing
  message. Gated twice, by `channels.telegram.actions.reactions` *and* by
  `reactionLevel` being above `"off"`, and a miss on either returns
  `{ok: false, reason: "disabled"}` with a hint not to retry rather than an
  error. `openclaw.example.json5` carries both keys, commented out, with the
  reasoning.

The second one is why `SKILL.md` tells the agent not to react when it has no
concrete message id: an emoji reaction is *on* a message, and the only way to
name that message is an id it was actually given.

**A `file_id` belongs to a bot, not to a sticker.** Send the sticker to your bot
from your own account and read the id off the update it receives; the same
sticker under a different bot token is a different id. So the table does not
survive replacing the bot, and it is not something to look up anywhere. There is
no artwork in this repository and there is not going to be — the sticker set is
per installation, which is the whole reason the mapping sits in the workspace
and not in `gamereg.config.json`.

**The tokens are identifiers and are never translated.** Five of them, closed:
`filed`, `approved`, `archived`, `pending`, `puzzled`. Four collide by name with
the register's localized vocabulary, which is prose the agent gets from
`gamereg vocab` and says out loud. A translated token matches no row in the
table and the reaction silently does not happen. `docs/spec/05-agent.md`'s
*Reactions* section says this too, and it is written down in three places on
purpose.

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

Then the check-in, which is the one step that cannot start from the phone. Point
the wrapper at a throwaway vault holding one session opened five hours ago, run
it by hand, and answer on the phone:

```bash
GAMEREG_VAULT=/tmp/checkin-vault ~/.openclaw/checkin.sh
```

The message should name the game and how long it has been open, offer a break,
and read as an offer rather than a verdict. Tap "taking a break" and check the
throwaway vault: a `session.break_start`, and a `event.amend` moving the
check-in's outcome to `break_started`. A run of the real thing on the real vault
files real events, which is why this one gets its own vault.

Last: message the bot from another account, and confirm nothing happens.

## What is not here

**No sticker artwork, and none is coming.** The reaction tokens are wired end to
end — the vocabulary in `SKILL.md`, the mapping table in
`workspace/REACTIONS.md`, the two gateway switches in
`openclaw.example.json5`, and step 9 above for how a `file_id` is obtained —
but every row of the table is empty, so the feature is inert until somebody
fills it in. That is the finished state for this repository: the sticker set is
per installation.

The check-in machinery is built on both sides now. `gamereg due` and
`gamereg checkin` carry the triggers, the delivery windows, the backoff ladder
and the ceiling; `checkin.sh` and the cron job in step 8 turn a non-empty `due`
into a wake; `SKILL.md`'s *Check-ins* section says what to do with one. The
Registrar is no longer silent until spoken to.

The `stats` target is built: with it declared in `build.targets`, a build also
writes `obsidian/Stats.md`, one `obsidian/reviews/<year>.md` per year played and
a calendar heatmap for each. Both notes are spliced, so a paragraph the user
pastes around the tables survives the next build — which is the only way a
review's prose gets there, since the agent writes no files and no command files
one.

What is still absent from phase 3: the `quartz` target. `gamereg build quartz`
is still refused, at exit 2 — it is inside the current phase and not written
yet, which `UNBUILT_TARGETS` in `core/vocab.ts` is what names.
