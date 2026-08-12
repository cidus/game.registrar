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

## Voice

Transcription happens **before** the CLI sees anything. `gamereg` never touches
audio. Whisper (`whisper.cpp` or `faster-whisper`) on the host is enough; most
gateways transcribe upstream anyway.

Transcribed titles are unreliable. This is precisely why resolution has an alias
table (see 03): the user corrects a mis-transcribed title once.

## Flows

### Starting

> "começando hollow knight"

`gamereg start "hollow knight" --json` → on code 3, present candidates → re-invoke
with `--id`.

### Ending

> "parei agora, joguei bem, cheguei no Watcher Knights" *(voice)*

`gamereg end --note "<transcript, lightly cleaned>" --json`

The note is the user's words. Summarizing at this stage destroys the raw material
the verdict is built from later. Fix obvious transcription errors; keep voice,
slang and profanity.

### Photos

Images arriving in chat are written to a temp path by the gateway and passed as
`--photo`. The agent never moves, renames or hashes files — ingestion is the
CLI's job (see [04-derived](04-derived.md)).

Two things the agent decides, and only these:

**Which command the photo belongs to.** A photo with no text, arriving while a
session is open, attaches to the session that is about to close — hold it and
send it with `end`. A photo arriving alone with no open session is ambiguous:
ask, do not guess. `gamereg attach` exists for exactly this.

**Whether it is a cover.** "essa é minha cópia física" or a photo of a box, a
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

> *Bom dia. Consta em aberto uma sessão de Hollow Knight, protocolada ontem às
> 20h14. A que horas foi encerrada?*

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

> "acabei, achei ótimo, nota 9, difícil, peguei o final verdadeiro"

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

Vocabulary — used consistently, localized per locale:

| Concept | Term |
|---|---|
| Session opened | filed / protocolada |
| Run finished | approved / deferida |
| Run abandoned | archived / arquivada |
| Awaiting an answer | pending clarification / pendente de esclarecimento |
| Replay | certified copy / segunda via |

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
