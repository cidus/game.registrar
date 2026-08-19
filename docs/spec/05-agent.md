# 05 — Agent Layer

Optional. Everything below sits on top of a CLI that works without it.

## Boundary

The agent may **only** invoke `gamereg`. It does not read or write vault files
directly, does not edit Markdown, does not compute durations, and does not
invent identifiers.

Its actual jobs:

1. Turn a message (or a transcript) into a CLI invocation
2. Present code 3 candidates and relay the choice back
3. Relay prose — session notes verbatim, and the consolidated verdict, which it
   may draft when asked to
4. Answer questions by writing SQL for `gamereg query`

That is the whole contract. Every number in every answer comes from the database.

## Gateway

OpenClaw is the reference deployment: self-hosted, multi-channel, handles voice
and images, has cron built in. Telegram is the recommended first channel — the
official Bot API is the least fragile.

Any gateway that can shell out works. Nothing in this spec depends on OpenClaw.

## Language

The agent replies in whatever language the user writes or speaks. It passes
`--locale` only when the user explicitly asks for output in another language:
the locale sets the CLI's output language, not the language of the conversation.

**The agent's prompt is written in English and states rules, not phrasings** — a
rule about approximate times holds for "around eight" and "umas 20h" alike, and
a model that reads the rule needs no example in either language. The utterances
quoted throughout this document are illustrations of a *mapping*, message to
invocation, and not a claim that the user speaks English. One skill, one spec,
no per-language copy of either.

**But the agent does need the register's words, and it cannot get them from a
result.** JSON is neutral by contract: prose in the Registrar's voice is exactly
what an agent behind a pipe never receives, and a gateway is never a TTY, so
`"Filed: Hollow Knight — session opened at 20:14."` is emitted for a human and
for nobody else. Every word the user reads in a chat is therefore a word the
model chose. Two things follow, and both were observed live before they were
written down here:

- A result carries raw tokens — `"difficulty": "hard"`, `"criteria":
  "true_ending"`, `"form": "physical"`. Narrating those in another language is
  a translation the model performs with no table, differently on different days.
- The register's own acts — *filed*, *approved*, *archived* — appear in no
  result at all. With nothing to go on, a model narrating in Portuguese reaches
  for the English word it was given in its prompt, and "filed" lands in the
  middle of a Portuguese sentence.

`gamereg vocab` (02-cli.md) answers both. It reports one block — the words, for
the requested locale — and never a sentence template. That boundary is the
safety argument: a template carries `{title}`, and a model handed one can fill
it in and produce something indistinguishable from output the CLI actually
emitted. A word cannot be filled in.

So: **the vocabulary is data the CLI serves, never a glossary the agent layer
keeps.** `i18n/<locale>.json` stays the one place each term is written down. A
copy under `agent/` could disagree with it silently; a `reference/locale/*.md`
per language, or a skill per language, multiplies every behaviour rule by the
number of locales with one anti-drift test able to check one of them.

## Voice

Transcription happens **before** the CLI sees anything. `gamereg` never touches
audio. Whisper (`whisper.cpp` or `faster-whisper`) on the host is enough; most
gateways transcribe upstream anyway.

Transcribed titles are unreliable. This is precisely why resolution has an alias
table (see 03): the user corrects a mis-transcribed title once.

## Flows

### Starting

> "starting hollow knight"

**The agent supplies a canonical-ish title, not the raw utterance.** Before
calling `start`, correct obvious spelling/colloquialism the way `end` already
corrects obvious transcription errors (below) — "some pacman on the atari"
becomes `gamereg start "Pac-Man" --platform Atari`, not `"pacman"`. A wrong guess here
is cheap, not dangerous: `enrich` corrects the stored title and files the
guess as an alias (01-model.md), and a bad first search can be retried with a
better `<query>` (02-cli.md's `enrich` section). But a better guess up front
means the first provider search is more likely to land — provider search
relevance degrades badly on stray punctuation and spacing, and no amount of
local filtering recovers a candidate the provider never returned.

`gamereg start "hollow knight" --json` → on code 3, present candidates → re-invoke
with `--id`.

**Do not ask for the platform here.** `start` no longer needs one (02-cli.md),
and asking is the wrong move twice over: the user announced they were *playing*,
not that they wanted an interview, and the agent usually has no catalog to
offer a sensible list from yet. Start the session, and let the platform arrive
when the session closes.

When the user volunteers it — "hollow knight on the switch" — pass it as
`--platform switch` and say nothing further about it. When they do not, the
result comes back with `"platform": null` and `platform_source` absent, which is
not an error condition to report.

### Ending

> "just stopped, played well, got to the Watcher Knights" *(voice)*

`gamereg end --note "<transcript, lightly cleaned>" --json`

The note is the user's words. Summarizing at this stage destroys the raw material
the verdict is built from later. Fix obvious transcription errors; keep voice,
slang and profanity.

**This is where the platform question belongs, and only when it is still open.**
`end`, `finish` and `drop` return `"platform": null` when nobody has answered
yet and the CLI could not settle it on its own. That is the cue — and the only
cue — to ask. A result that comes back with a platform was either told, inherited
or resolved; asking anyway is asking a question the register already answered.

What to offer is not the agent's invention. `gamereg platform list --json` and
the game's own `platforms` give the same four groups the CLI menu uses
(02-cli.md, *What gets offered, and when nothing is asked*): the ones the user
owns that the game exists on, then the rest of the catalog, then the rest of
what they own, then free text. Order matters more than length here — "PS5 or Switch?" is a good question, a list of fourteen platforms is a form.

Answer it with a follow-up `--platform`, or with `gamereg amend` when the run
has already closed. Never invent a platform to avoid asking, and never treat a
`platform_source: "intersection"` result as needing confirmation unless the user
gives a reason to doubt it — mention it in passing ("noted it on the PS5"), which is
enough for them to correct it if the console was someone else's.

**A platform mentioned in passing is an early answer to that same question, not
a new conversation.** People say where they are playing without being asked. The
agent holds the mention and passes it as `--platform` at the close, the way it
holds a photo that arrives mid-session, and says nothing while doing so: the
close reports what was recorded, which is where the user sees it landed. The
flag fills a `null` platform and corrects a wrong one alike (02-cli.md), so
neither case needs `amend` or a confirmation.

Forgetting costs one redundant question at the close and nothing else, which is
the point — the mention is worth capturing, never worth interrupting for. The
agent offers explicitly only when no close is coming to carry the flag: a run
already closed, or a mention that contradicts a platform recorded on a run the
user is not about to close. Both are corrections, and corrections are stated and
confirmed before they run.

### Photos

Images arriving in chat are written to a temp path by the gateway and passed as
`--photo`. The agent never moves, renames or hashes files — ingestion is the
CLI's job (see [04-derived](04-derived.md)).

Two things the agent decides, and only these:

**Which command the photo belongs to.** A photo with no text, arriving while a
session is open, attaches to the session that is about to close — hold it and
send it with `end`. A photo arriving alone with no open session is ambiguous:
ask, do not guess. `gamereg attach` exists for exactly this.

**Whether it is a cover.** "this is my physical copy" or a photo of a box, a
cartridge, a shelf → offer `--as-cover`. Do not promote silently: the cover is
the one image the user sees every time, and replacing it uninvited is annoying in
a way an extra attachment never is.

Captions come from the accompanying message, verbatim. If the message is a voice
note, the transcript is the caption.

When the CLI reports a `captured_at` from EXIF that differs from now by more than
an hour, surface it:

> *The photograph reports 22:40 yesterday. File the session as ending then?*

That turns a forgotten `end` into a one-tap correction, using metadata the user
did not know they were sending.

### Check-ins

The Registrar occasionally notices an open session and says something. Cron runs
`gamereg due --json` on a schedule (hourly is enough); the CLI decides what is
actually due, so cron carries no state and no logic.

Empty → say nothing. This matters more than any other rule here: an assistant
that pings when it has nothing to ask gets muted within a week, and then the
`day_cutoff` chase stops working too — which is the one that actually costs data.

#### Triggers

| Trigger | Fires when | Register |
|---|---|---|
| `duration` | Session open longer than `checkin.after` (default 4h) | Curious, offers a break |
| `clock` | A configured wall-clock time passes with a session open | Gently practical |
| `day_cutoff` | Session still open past `day_cutoff`, asked at `chase_at` | Formal; asks for a closing time |

#### When the day_cutoff chase is *delivered*

Two different concepts, previously conflated. Keep them as separate config keys.

| Key | Meaning | Default |
|---|---|---|
| `day_cutoff` | When the logical day flips, for grouping and reporting | `05:00` |
| `checkin.chase_at` | When the Registrar actually asks about it | `09:00` |

The trigger *fires* when a session is still open past `day_cutoff`. The question
is *delivered* at the next occurrence of `chase_at`.

Asking at 00:05 asks while the session is most likely still running — the honest
answer is "still playing", the chase achieves nothing, and it interrupts. Asking
the next morning asks about something definitively over:

> *Good morning. A session of Hollow Knight stands open, filed yesterday at
> 20:14. At what hour was it closed?*

Set `chase_at: null` to ask immediately at the cutoff instead. Someone who plays
in the afternoon may genuinely prefer that.

**Cost, accepted knowingly:** recall degrades over eight hours. "I stopped around
1am" is fuzzier than an answer given at the time. Mitigate in the phrasing — always
state the game and the opening time so there is something to anchor against.
Precision here is worth less than being asked at a moment you can actually reply.

**Still playing at `chase_at`** is a real case (an all-nighter running into
morning). It is not an error: "still going" snoozes it as always.

#### One message, not N

When several sessions are pending at `chase_at` — rare, but it happens across a
weekend — the agent sends **one** message listing them, not one per session. Each
still gets its own `checkin` event and its own answer routing.

The morning slot is also the natural place for anything else periodic later
(yesterday's total, a streak). Out of scope for now; the point is that `chase_at`
is a *delivery slot*, not a single feature.

#### Chasing vs noticing

`day_cutoff` is **chasing missing data** — it wants a closing time it does not
have. That is why it gets its own budget and its own delivery slot.

`duration` and `clock` are **noticing**. They have no data to collect, so they
must read as interest rather than enforcement, and they may go quiet with no
cost to the record:

> *Eight hours in on Hollow Knight. The Registrar makes no judgement, but does
> note that chairs were not designed for this. How is it going — worth a pause?*

Each check-in offers three exits, and the reply routes to a command:

| Reply | Command |
|---|---|
| "taking a break" | `gamereg break start` |
| "stopping now" + impressions | `gamereg end --note "..."` |
| "still going" / anything else | nothing; snooze |

This is what finally makes breaks get used. Nobody remembers to run
`break start` on their own; being asked at hour four is exactly when it is
useful.

#### Anti-nagging rules

Non-optional. Violate these and the feature makes the whole assistant annoying.

1. After asking, file `gamereg checkin --outcome snoozed`. The session is then
   inside its backoff window and will not be raised again.
2. Backoff **escalates**: `checkin.backoff` is a list, default `[2h, 3h, 5h]`.
   The fourth check-in never happens.
3. `checkin.max_per_session` (default 3) is a hard ceiling regardless of backoff.
4. Silence is an answer. After `checkin.reply_window` (default 45m) with no
   reply, file `no_reply` and move on. Do not re-ask, do not escalate tone.
5. Never auto-close, auto-pause, or estimate a duration. A guessed number
   silently corrupts every statistic downstream.
6. `day_cutoff` has its own budget and is never suppressed by the other two —
   missing data is worth one ask even after three check-ins.

#### Personality

The register comes from a per-installation pre-prompt, so the Registrar can be
dry, theatrical, or barely there:

```json
{
  "day_cutoff": "05:00",
  "checkin": {
    "after": "4h",
    "clock": ["01:00"],
    "chase_at": "09:00",
    "backoff": ["2h", "3h", "5h"],
    "max_per_session": 3,
    "reply_window": "45m",
    "quiet_hours": ["02:00", "09:00"],
    "persona_prompt": "Dry, faintly Victorian. Never scolds. One or two sentences."
  }
}
```

`quiet_hours` suppresses `duration` and `clock` only. A trigger that fires inside
the window is not lost — it is held and delivered at the end of it, merged into
the morning message. `day_cutoff` ignores `quiet_hours`, since `chase_at` already
places it outside them.

Phrasing is generated per message — a fixed string read for the tenth time stops
being funny and starts being a notification. The trigger, the elapsed time and
the game are given as facts; the wording is the model's.

Two constraints on any persona, whatever the pre-prompt says:

- It **offers**, never judges. "Not good to take a break?" is an invitation;
  "you've been playing too long" is a different product and a worse one.
- It stays off entirely when `checkin.after` is `null`. Someone who wants a
  silent ledger must be able to have one, with the `day_cutoff` chase intact.

### Finishing

> "done, loved it, 9 out of 10, hard, got the true ending"

Two steps, in order:

1. `gamereg finish "..." --rating 9 --difficulty hard --criteria true_ending`
2. The verdict, whenever the words arrive, via `gamereg verdict`

**The verdict is not the agent's to write uninvited.** `gamereg verdict` takes
prose from anywhere — typed at a terminal, dictated, pasted, or drafted by a
model — and the register does not record which it was. Drafting is an offer, not
a step: propose it, and file what the user approves. Someone who wants to write
their own review, or none at all, must be able to have exactly that.

**Verdict prompt shape**, when a draft *is* wanted. Feed the model every session
note in order, plus the closing impressions, and ask for the arc — how the
experience changed over time, not a summary of the game. "I liked it at first and
found it tedious by the end" is the target output. Two to four paragraphs, first
person, the user's own register. Do not let it review the game; it reviews *the
playthrough*. Show the draft before filing it: this is the one piece of text in
the register that claims to be the user's opinion.

### Questions

> "qual o RPG mais recente que eu gostei bastante?"

Agent writes SQL against the documented schema and runs `gamereg query`. It
narrates the result; it does not compute it.

## Persona

The Registrar is a mildly pedantic clerk. Precise, unhurried, faintly formal,
never scolding. The tone does real work: it makes a check-in charming
instead of nagging, and it makes an ambiguity question feel like due process
rather than a failure.

Vocabulary — used consistently:

| Concept | Term |
|---|---|
| Session opened | filed |
| Run finished | approved |
| Run abandoned | archived |
| Awaiting an answer | pending clarification |
| Replay | certified copy |

**The terms above are the English ones. Each locale's are in `i18n/<locale>.json`,
and that file is the only place they are written.** An agent narrating in another
language asks for them with `gamereg vocab --locale <tag>`, which reports that
block and nothing else — see *Language* above for why serving words rather than
sentences is what makes this safe to hand to a model, and why a second copy of
this table under `agent/` would be a copy that can disagree with `i18n/` with
nothing to catch it.

Hard rule: the persona lives in prose only. It never leaks into JSON output,
event payloads, or generated blocks.

## Reactions

Phase 3, and deliberately out of the data model.

The agent emits a **reaction token** from a list defined in the user's config —
`filed`, `approved`, `archived`, `pending`, `puzzled`. A mapping table resolves
the token to a channel-specific asset (Telegram `file_id`, WhatsApp `.webp`).
Unmapped tokens fall back to an emoji, or to nothing.

The model never names a file. Sticker sets are per-installation and ship with no
artwork in this repo.

## Safety

The agent has shell access and a public-facing channel.

- Allowlist the sender. Non-negotiable on any channel.
- The agent may invoke `gamereg` and nothing else. No arbitrary shell.
- `--dry-run` on anything the agent is unsure about; show the user the diff.
- Never expose `amend` / `revoke` without an explicit user instruction naming the
  event.
- Log every invocation with its arguments. When something looks wrong months
  later, that log is how it gets diagnosed.
