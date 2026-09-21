# 02 — CLI

Binary: `gamereg`. Every command accepts localized aliases from
`i18n/<locale>.json`; English tokens below are canonical.

## Two independent axes

Output format and interactivity are separate decisions that happen to correlate.
Do not couple them in the implementation.

| Axis | Question | Default |
|---|---|---|
| Output format | prose or JSON? | prose when stdout is a TTY |
| Interactivity | may I prompt the user? | yes when stdin **and** stdout are TTYs |

Both default from the environment. Both can be overridden. **Neither requires a
flag in the common case** — a human in a terminal gets menus, an agent behind a
pipe gets JSON and never blocks, and neither has to ask. This is invariant 13
([00-architecture](00-architecture.md#invariants)).

### Interactivity resolution

Prompting is allowed only when *all* of these hold:

1. `process.stdin.isTTY` **and** `process.stdout.isTTY`
2. `--non-interactive` was not passed
3. `--json` was not passed (JSON output plus a prompt is incoherent)
4. `GAMEREG_NON_INTERACTIVE` is unset, empty or `0`
5. `CI` is unset, empty or `0`

Otherwise the command is non-interactive and returns per the output contract.

`--non-interactive` exists for one specific reason: **some agent harnesses
allocate a pty.** Under a pty, `isTTY` is true and the process would sit forever
on a prompt nobody can answer. Gateways should set
`GAMEREG_NON_INTERACTIVE=1` once in the environment rather than adding a flag to
every invocation.

`--yes` is unrelated. It pre-answers the confirmation of exit code 7; it does not
enable or disable prompting.

## Output contract

**JSON is emitted when stdout is not a TTY, or when `--json` is passed.**
Otherwise output is human-readable prose in the Registrar's voice.

Success:
```json
{ "ok": true, "action": "session.open", "result": { ... }, "events": ["01K..."] }
```

Failure:
```json
{ "ok": false, "code": 3, "error": "ambiguous", "message": "...", "candidates": [ ... ] }
```

`ok` is always present. Machine callers branch on `code`, never on `message` —
messages are localized and may change.

`events` carries the ids of the events this invocation appended, in order;
it is `[]` for a command that appends none. Under `--dry-run` the same ids are
reported alongside `"dry_run": true`, and nothing is written. A failure envelope
carries whatever `details` the error attached: `candidates[]` for code 3,
`result` for a partial failure (`build`, `enrich`, `import`), `problems[]` for
`doctor`.

## Exit codes

| Code | Name | Meaning |
|---|---|---|
| 0 | ok | |
| 1 | error | Unexpected failure |
| 2 | usage | Bad arguments, unknown enum value, unknown config key |
| 3 | ambiguous | Multiple candidates; `candidates[]` is populated |
| 4 | not_found | No candidate at all; an unknown id or reference |
| 5 | conflict | State conflict (session already open, nothing open to close, a build already running) |
| 6 | provider_unavailable | Network or provider failure; local work was still committed |
| 7 | needs_confirmation | Destructive; re-run with `--yes` |

Code 3 is the backbone of the agent flow. See [03-resolution](03-resolution.md)
and [ADR 0004](../decisions/0004-provider-ambiguity-is-returned.md).

## Global flags

Declared on the program *and* on every command, so they may precede or follow
the verb.

| Flag | Effect |
|---|---|
| `--json` | Force JSON output. Implies `--non-interactive`. |
| `--non-interactive` | Never prompt. Return candidates and exit instead. |
| `--yes` | Pre-answer confirmations (exit code 7). Not related to prompting. |
| `--vault <path>` | Override vault root (default: `$GAMEREG_VAULT` or cwd) |
| `--locale <tag>` | Override locale |
| `--dry-run` | Compute everything, write nothing. Prose prints the events that would be appended; JSON reports their ids plus `dry_run: true` |
| `--at <time>` | Override the semantic timestamp (see below) |
| `-q, --quiet` | Suppress prose. JSON output and exit codes are unaffected |
| `-V, --version` | Print the version and exit 0 |
| `-h, --help` | Print help for the program or the command and exit 0 |

### Time parsing for `--at`

Four accepted forms, tried in this order. Ambiguity resolves toward the past —
you file things after they happen, never before.

| Form | Example | Reading |
|---|---|---|
| Relative | `-90m`, `-90min`, `-2h`, `-1.5h` | that much before now; a decimal amount is allowed |
| Clock | `20:14` | that time today, or **yesterday when it is later than now** |
| Local date and time | `2026-08-12 20:14`, `2026-08-12T20:14` | in `config.timezone`, or the local zone when unset |
| Full ISO 8601 | `2026-08-12T20:14:00-03:00` | as written, offset included |

The clock form compares against *now*, not against `day_cutoff`: `23:52` typed
at 01:00 means last night. Anything else is a usage error (code 2).

### Environment

| Variable | Effect |
|---|---|
| `GAMEREG_VAULT` | Vault root, when `--vault` is not passed |
| `GAMEREG_NON_INTERACTIVE` | Never prompt. What a gateway sets once, per above |
| `GAMEREG_SOURCE` | The envelope's `source` on every event this invocation appends: `cli` (default), `chat`, `cron`, `import` |
| `GAMEREG_LOCALE` | Output language, when neither `--locale` nor `config.locale` is set |
| `LC_ALL`, `LANG` | Consulted after `GAMEREG_LOCALE`; an unknown tag degrades to its base language, then to `en` |
| `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | Provider credentials — see *Provider credentials* |

`GAMEREG_SOURCE` is validated against the vocabulary, and an unknown value is a
usage error (code 2) rather than a value that gets written. It is the one part
of the event envelope supplied from outside, and the log is append-only
(invariant 1): a typo here would be recorded permanently on every event of that
invocation, and no later command could take it back.

## Recording commands

### `gamereg start <query>` — open a session

```
gamereg start "hollow knight" [--id igdb:7346] [--platform switch]
                              [--form digital] [--mode solo] [--replay]
                              [--past-hours 30] [--at 20:14] [--no-metadata]
                              [--photo p.jpg] [--caption "..."] [--kind box]
                              [--as-cover]
```

Behaviour:
1. Resolve `<query>` to a game (see [03-resolution](03-resolution.md)).
   `--id <ref>` answers the resolution outright and files the query as an alias.
2. If no open run exists for it, append `run.open`. If one exists, reuse it.
   `--replay` forces a new run even when an open one already exists — the one
   case where you deliberately want two runs of the same game open at once
   (a speedrun restarted without formally dropping the run in progress). A
   *closed* run never blocks a new one; that already happens with no flag.
3. Append `session.open`.

**`--past-hours <n>`** stamps a stated baseline onto the `run.open` this
creates — playtime that happened before this vault started tracking it ("I
already have 30h on it in Steam"). Only meaningful when step 2 actually opens a new
run; combining it with a query that reuses an already-open run is a usage
error (code 2) — there is no new `run.open` for it to land on, and the
correct tool for adding a stated number to a run already in progress is
`gamereg amend`. See [01-model](01-model.md#duration) for how a stated baseline
and measured sessions add up on the same run, and `past`'s section below for the
sibling command that does the same thing without opening a session.

Conflict (code 5) if a session is already open for that run. If a session is open
for a *different* game, that is not an error — parallel runs are allowed and
common. The Registrar mentions it, and the result carries **`also_open`**: one
entry per session still open elsewhere, with `session_id`, `run_id`, `game_id`,
`title` and `started_at`. Absent when there is none.

That field exists because the prose alone cannot serve a caller that never sees
prose. Opening a session while another is open usually means the person switched
games rather than started playing two, so an agent needs both the fact and the
ids to offer closing the other one ([05-agent](05-agent.md)). It stays an offer:
`start` never closes anything, and someone genuinely playing two games in an
evening is not doing anything the register objects to.

Metadata enrichment does **not** happen here. `run.open` writes only what is
known locally; `gamereg enrich` runs afterwards, possibly from cron. A start
command must never fail because a provider is down (invariant 5).

`--no-metadata` creates a local-only entry from the raw string when nothing
matches. Without it, and with nothing to match, a non-interactive `start` exits
4 and the message names the flag; a human is offered the same thing as a
one-item menu.

**Platform is not required to start.** Resolution order is `--platform` → the
game's last run → `config.defaults.platform` → a single-member catalog
intersection (*Platform vocabulary* below). When none of those answer,
`run.open` is staged with `platform: null` and the session opens anyway. No
prompt, no exit 2. `error.platform_required` does not exist.

That is deliberate: starting to play is the one moment where a question is
pure friction, and it is also the moment when the answer is least informed —
the game may not have been enriched yet, so there is no catalog to narrow
anything with. `end`, `finish` and `drop` ask instead, and by then there
usually is one. See *Platform, when a run closes* below and
[ADR 0023](../decisions/0023-late-platform-fill-on-close-only.md).

`--platform` is never validated against a list. It is canonicalized
(*Platform vocabulary*) and recorded as given, and a platform given here joins
`config.platforms`.

### `gamereg end [<query>]` — close a session

```
gamereg end [--id game:01K...] [--at 23:52] [--break 40m] [--note "..."]
            [--platform switch]
            [--photo p.jpg] [--caption "..."] [--kind screenshot] [--as-cover]
```

`<query>` is optional and usually omitted: with exactly one open session, it is
implied. `--id <ref>` names the game instead of the query.

| Situation | Result |
|---|---|
| Exactly one session open | closes it |
| No session open | code 5 (`error.no_open_session`) |
| Several open, nothing named | code 3, `candidates[]` — **game** candidates (`ref: game:<id>`), one per open session |
| Several open, interactive | the same candidates as a menu |
| A game named that has no open session | code 5 (`error.no_open_session_for`) |

`--break` accepts `40m`, `1h20`, `90`. Additive with logged breaks. A closing
time before the opening one, or breaks longer than the session, is a usage error
(code 2).

### `gamereg break start|end`

```
gamereg break start [<query>] [--id <ref>] [--at 21:10]
gamereg break end   [<query>] [--id <ref>] [--at 21:40]
```

Opens or closes a break inside an open session. The session is named the same
way `end` names it: implied when exactly one is open, otherwise `[query]` or
`--id`, otherwise code 3.

Code 5 when no session is open (`error.no_open_session`), when a break is already
open (`error.break_already_open`), or, for `break end`, when no break is open
(`error.no_open_break`).

### `gamereg finish <query>` — close a run

```
gamereg finish "hollow knight" [--id <ref>] [--rating 9] [--difficulty hard]
                               [--criteria true_ending] [--at ...] [--note "..."]
                               [--platform switch]
                               [--photo p.jpg] [--caption "..."] [--kind photo]
                               [--as-cover]
```

Every flag is optional. If a session is still open, close it first at `--at` (or
now), then append `run.close` with `outcome: finished`. No open run for that game
is a conflict (code 5, `error.no_open_run`).

`--criteria` defaults to `credits`. `--rating` accepts an integer 0–11, or
`none` / `null` / `-` for "refusing to rate is data"; anything else exits 2.
`--criteria` and `--difficulty` validate against the vocabulary; an invalid token
exits 2 and lists valid ones.

This command does **not** write the consolidated verdict. That arrives separately,
whenever the words do, via `gamereg verdict`.

### `gamereg drop <query>` — abandon a run

```
gamereg drop "the witness" [--id <ref>] [--rating 5] [--difficulty brutal]
                           [--criteria abandoned] [--reason "..."]
                           [--platform switch]
                           [--photo p.jpg] [--caption "..."] [--kind photo]
                           [--as-cover]
```

Same as `finish`, with `outcome: abandoned` and `--criteria` defaulting to
`abandoned`. It takes `--reason` where `finish` takes `--note`, and **the reason
is written into the `run.close` payload's `note` field** — there is no separate
field for it, so it is read back, rendered and corrected as `note`.

### Platform, when a run closes

`start` may leave a run with `platform: null`. `end`, `finish` and `drop` are
where that gets settled — by then the game has usually been enriched, so the
catalog can narrow the question, and a question asked while closing costs
nothing next to one asked while starting.

All three accept `--platform <name>`, which answers it outright and is the
path a script or an agent takes. The flag both fills a `null` platform and
replaces one already recorded — the same correction `amend` would make, issued
from the command that is already closing the run, so a user who says the
console only as they finish needs no second step. Without the flag, and **only
when the run's platform is still `null`**:

- **Interactive** — the grouped, unfiltered `select` described under
  *Platform vocabulary* below. A first group with exactly one member settles
  it with no menu at all.
- **Non-interactive** — a single-member first group still settles it. Every
  other case leaves `null` and **does not exit 3**. A closed run with an
  unknown platform is a fact, not an ambiguity to resolve; refusing to close
  a session over a metadata field would be the tail wagging the dog. The JSON
  result carries `platform: null`, and an agent that wants the answer asks
  for it on its own terms and follows up with `--platform` or `gamereg amend`.

The fill is an **`event.amend`** targeting the event that created the run —
`run.open`, or `run.import` for a historical entry — with
`patch: { "platform": "..." }`. No new event type, no schema change, and the
amend's `reason` names which command settled it (`session.close` or
`run.close`). It is also the correction path when a
`platform_source: "intersection"` resolution turns out wrong.

This is entirely offline. `game.platforms` comes from the folded state,
whatever a previous `enrich` left there; a run closed for a game that was
never enriched simply keeps `null`, and nothing reaches the network to avoid
that. Invariant 5 holds without exception, and `enrich` never writes to
`run.*` — the two commands stay on their own sides of the line
([ADR 0023](../decisions/0023-late-platform-fill-on-close-only.md)).

### `gamereg past <query>` — file a game run started in the past

```
gamereg past "chrono trigger" --ended 2011-07 --rating 10
             [--id <ref>] [--started ...] [--hours 30] [--criteria credits]
             [--difficulty hard] [--outcome finished] [--note "..."]
             [--platform snes] [--form physical] [--mode solo] [--no-metadata]
             [--photo p.jpg] [--caption "..."] [--kind box] [--as-cover]

gamereg past "opus magnum" --hours 30 [--started 2026] [--platform steam]
```

**With `--ended`**: emits `run.import`, a closed run whose hours are stated.
Date precision is inferred from the shape of the argument: `2011` → year,
`2011-07` → month, `2011-07-14` → day. `--outcome` defaults to `finished`, and
`--criteria` defaults to `credits` for a finished run and `abandoned` for an
abandoned one. `--started` defaults to `--ended`; when both are given, the run
records the coarser of the two precisions.

**Without `--ended`**: emits `run.open` instead — the same event `start`
appends, carrying `--hours` as a stated baseline, but with no `session.open`
alongside it. This is the command for "I'm currently playing X, already have
N hours in it" said about a game you are not sitting down to play *right
now* — the onboarding case, and the case of listing several games at once in
one conversation. `start --past-hours` is the sibling that does the same
thing but also opens a session, for when you *are* about to play. Requires
`--hours` — omitting both `--ended` and `--hours` is a usage error (code 2),
since at that point there is nothing left for `past` to say that `start`
doesn't already say better. `--rating`, `--difficulty`, `--criteria` and
`--outcome` describe how a run *closed*; passing any of them without
`--ended` is also a usage error. Conflict (code 5) if a run for this game is
already open — `past` never reuses one, the way `start` does; the game
already has an open run to add a session to (`start`) or a baseline to
correct (`amend`).

`--started`, omitted in this form, defaults to the current year rather than to
today — "I don't remember when I started" is the common case this command exists
for, and a guessed exact day would be a lie the way `run.import`'s
date-precision rule already refuses to tell. Give `--started` and it is used
exactly as typed, at whatever precision its shape implies.

> The open-run form carries less than the closed one: `--note` is not written
> onto the `run.open`, and `--photo` files are ingested (and reported in
> `result.attachments`) without being attached to the run. Only `--as-cover`
> reaches the log from those flags. The closed form records both.

`past` files runs in bulk, frequently several in a row, so it does **not**
prompt for a platform the way `end`/`finish`/`drop` do — true for both forms.
The platform comes from `--platform` → the game's last run →
`config.defaults.platform`, and the open-run form adds the catalog intersection
after those, since it shares `start`'s defaults. Only when every one of those is
empty does the run keep `platform: null`, to be amended later. The value is
canonicalized like everywhere else. Unlike `start` and the closing commands,
`past` reports no `platform_source` and never adds what it was given to
`config.platforms`.

Resolution is offline and creates what it does not find, so a query that matches
nothing non-interactively exits 4 naming `--no-metadata`; with the flag, the
title becomes a new local entry.

### `gamereg verdict <query>` — file the consolidated review

```
gamereg verdict "hollow knight" -m "Started as a curiosity and turned into..."
gamereg verdict "hollow knight" --text review.md
gamereg verdict "hollow knight" --text -          # stdin
gamereg verdict "hollow knight" --run 01K...      # a specific playthrough
gamereg verdict "hollow knight" --id game:01K...  # name the game by reference
```

Appends `run.verdict`, which the build renders into the `verdict` block of the
game note. Prose enters as content, never as structured fields — no number in
the register is ever derived from it. This command takes no attachment flags.

The text comes from `-m/--message`, from `--text <file>`, or from stdin (`--text -`,
or no flag at all when stdin is a pipe). Typing it yourself and piping it in from
somewhere else are the same operation as far as this command is concerned. Empty
text, or none of the three, is a usage error (code 2); a named `--text` file that
does not exist exits 4.

`--run` names the playthrough. Omitted, it targets the most recently ended run,
falling back to the open one when nothing has ended yet — so a verdict written
right after `finish` lands where it is meant to, even if a replay is already
under way. An unknown `--run` exits 4; a game with no run at all exits 5.

Filing again replaces the previous verdict in the fold. The earlier text stays in
the log, as everything does.

## Query commands

### `gamereg search <term>`

```
gamereg search "zelda" [--platform switch] [--provider igdb] [--local-only]
```

Never writes. Returns candidates in the same shape used by code 3, and always
exits 0 — an empty result is an answer, not an error. This is what the agent
calls when it wants to look something up without recording anything.

A local match answers on its own; only an empty local result falls through to
provider search — resolution step 6 ([03-resolution](03-resolution.md)), which
lives here and in no write command. With no `--provider`, every *known* provider
is tried in the order the registry lists them, and the first to return anything
wins; one with no credentials is skipped silently rather than reported as a
failure. `--provider` narrows that fallback to a single catalog and rejects an
unknown name as a usage error, exactly as on `enrich`. `--local-only` skips
step 6 altogether, which also makes `--provider` moot.

`--platform` does two things against a provider: it is passed into the query as
every spelling the table knows for it
([ADR 0021](../decisions/0021-platform-hint-narrows-provider-query.md)), and it
then filters the results. Surviving provider candidates are **re-ordered** by how
many of their platforms this vault owns (`config.platforms`) — a preference, never
a filter, and a no-op for a vault that has configured none. Local candidates are
not re-ordered.

### `gamereg open` — list open sessions

Never writes. One row per open session, carrying the session's own facts
(`opened_at`, `open_for_minutes`, `uninterrupted_minutes`, `net_minutes`,
`on_break`, `break_started_at`, `checkins_so_far`) and three ids that exist for a
caller with no terminal:

| Field | What it names | Null when |
|---|---|---|
| `session_open_event_id` | the `session.open` event | never, for a listed session |
| `run_open_event_id` | the `run.open` event of this session's run | the run folded without its opening event, which `doctor` reports as an orphan |
| `last_checkin_id` | the `session.checkin` most recently filed against this session | no check-in has been filed |

**Entity ids and event ids are not interchangeable.** `session_id` and `run_id`
identify things; `amend` and `revoke` take the event ids above and nothing else.
The two are adjacent ULIDs minted in the same millisecond and look alike. See
[ADR 0065](../decisions/0065-status-exposes-correctable-event-ids.md).

`last_checkin_id` is here because the wrapper files a check-in *after* enqueueing
the wake, so the id cannot travel with the question itself. A closed session is
not listed, so an answer that closes one has to read the id first
([ADR 0043](../decisions/0043-agent-reads-last-checkin-id.md)).

### `gamereg due [--at <time>]`

Evaluates every check-in trigger against currently open sessions and returns only
those that are **due now**: past their threshold, outside their backoff window,
and inside their delivery window. This is the entire contract with cron: run it
on a schedule, act on what comes back, say nothing when the list is empty
([ADR 0034](../decisions/0034-poll-is-a-cron-command.md)).

Delivery windows are what let cron stay dumb. A `day_cutoff` trigger fires at
`day_cutoff` but is only *returned* from `chase_at` onward (default 09:00); a
`duration` trigger inside `quiet_hours` is held until the window ends. The CLI
does this arithmetic so every caller behaves identically — see
[05-agent](05-agent.md#check-ins).

`--at` (the global flag) evaluates as if it were another time, for testing.

```json
{ "ok": true, "result": { "due": [
  {
    "session_id": "01K...",
    "run_id": "01K...",
    "game": "Hollow Knight",
    "game_id": "01K...",
    "opened_at": "2026-08-12T20:14:00-03:00",
    "open_for_minutes": 412,
    "uninterrupted_minutes": 412,
    "net_minutes": 372,
    "on_break": false,
    "break_started_at": null,
    "trigger": "duration",
    "threshold": "4h",
    "checkins_so_far": 1,
    "last_checkin_at": "2026-08-12T23:14:00-03:00",
    "last_checkin_id": "01K..."
  }
] } }
```

The row is `open`'s, plus `trigger` and `threshold`, and minus the two event
ids — a check-in question never amends a run or a session, only the
`session.checkin` record `last_checkin_id` names, so carrying them would widen
every wake payload for a caller that has no use for them. `last_checkin_at` and
`last_checkin_id` name the same record, and it is the *previous* question — the
one this evaluation was measured against, never the one about to be asked.
`threshold` is the setting that fired, as configured: `checkin.after` (default
`4h`) for `duration`, the hour itself for `clock` and for `day_cutoff`. Rows are
ordered oldest session first.

The three minute figures answer three different questions, and a message built
from the wrong one is a wrong message: `open_for_minutes` is the wall clock
since the opening, `net_minutes` is that minus every break, and
`uninterrupted_minutes` is the stretch of play with no break in it — what
`duration` is measured against, live while the session plays and frozen at the
break that paused it
([ADR 0102](../decisions/0102-a-break-returns-duration-to-silent.md)).

`trigger` is what the agent uses to choose its register — see
[05-agent](05-agent.md). Never hardcode the phrasing here; the CLI reports facts.

**At most one row per session.** Several triggers can stand fired at once, and
two questions about one session is the same nagging by a longer route.
`day_cutoff` wins, being the only one chasing data it does not have; `duration`
outranks `clock`, knowing how long the session has actually run where `clock`
only knows what time it is
([ADR 0032](../decisions/0032-one-due-row-per-session.md)). Several *sessions*
still yield several rows, and the agent sends one message covering them
([05-agent](05-agent.md#check-ins)).

Backoff and thresholds are read from config; the CLI applies them, so every
caller behaves identically and cron needs no memory of its own. The ladder is
measured from the last check-in of any trigger and indexed by how many have been
asked; the ceiling counts only `duration` and `clock`, since `day_cutoff` has its
own budget. A `day_cutoff` chase is asked once per delivery slot, which is what
bounds a trigger exempt from both
([ADR 0002](../decisions/0002-chase-has-its-own-slot.md)). Quiet hours are
evaluated against the moment of evaluation, not the moment a trigger fired
([ADR 0033](../decisions/0033-quiet-hours-evaluated-now.md)).

### `gamereg checkin <session_id> --trigger <t> [--outcome <o>]`

Files a `session.checkin`. Called by **the cron wrapper, not the agent**, right
after the wake carrying the question has been enqueued. `--outcome` defaults to
`snoozed`, which is the only outcome the wrapper is ever in a position to know.
The outcome is amended later — `gamereg amend <checkin_id> --set outcome=…` — by
the agent when the user answers, or by `--expire` below when nobody does.

Both the argument and `--trigger` are declared optional, because `--expire` shares
this command, and both are then required in this form: omitting either is a usage
error (code 2). A session id no event mentions exits 4. An unknown `--trigger` or
`--outcome` exits 2 listing the valid tokens.

Where the check-in's own id comes from depends on who is asking. The wrapper has
it in this command's `result.checkin_id`. The agent does not, and cannot: the
wake goes out before this command runs, so at the moment the question reaches a
conversation the record does not exist yet. It reads `last_checkin_id` off
`gamereg open` instead
([ADR 0043](../decisions/0043-agent-reads-last-checkin-id.md)).

A check-in never mutates the session, and a session that closed between the wake
and this call is recorded rather than refused: the question *was* asked, and
losing that fact leaves the session eligible again on the next tick.

**The order is load-bearing: enqueue the wake first, file the check-in second.**
Filing first would put a session inside a backoff window having never been asked.
Filing second preserves the intended failure mode — forgetting to record a
check-in makes the assistant repeat itself, never go silent. See
[ADR 0031](../decisions/0031-wrapper-files-checkin-after-wake.md).

The wrapper owns this rather than the agent because the anti-nagging rules are a
clock and a counter, which invariant 7 keeps out of a language model. The agent's
only job in a check-in is choosing the words.

### `gamereg checkin --expire`

Sweeps every check-in still `snoozed` past `checkin.reply_window` — in any
session, open or closed — and amends each to `no_reply`. Takes no session,
trigger or outcome; passing one is a usage error (code 2). Runs on the same
schedule as `due`, from the same wrapper.

Silence is an answer, and this is what records it as one instead of inferring it
on read. See [01-model](01-model.md) for why that distinction is not pedantry.

### `gamereg status [<query>]`

Vault summary, or one game's state. Never writes. `--id <ref>` names the game
instead of the query; with neither, the summary form reports counts, total
minutes and what is currently being played.

Each run in the per-game form carries `run_open_event_id` and
`run_close_event_id` — the same kind of field `open` exposes, and for the same
reason. `status` is the only route to either for a run with no open session.

The two are not interchangeable: `platform`, `started_on` and the stated
`hours` are on the opening event, while `rating`, `difficulty`, `note`,
`outcome`, `completion_criteria` and `ended_on` are on the closing one, and
`amend` refuses the pairing that would write nothing. `run_close_event_id` is
`null` while the run is open, which includes a run filed by `past` without
`--ended`. A `run.import` — `past --ended`, or a row from `import` — carries both
halves in one event, so there the two ids are equal rather than one being absent.

### `gamereg query <sql>`

```
gamereg query "SELECT title, hours FROM v_finished ORDER BY rating DESC"
gamereg query --schema
```

Runs read-only SQL against `data/log.db`. This is how question-answering works —
the agent writes SQL, the database does the arithmetic, and no number is ever
hallucinated. The database is a cache (invariant 10) and this command only reads
it.

`data/log.db` exists only once `sqlite` is in `build.targets` and a build has
run. The default is `["obsidian"]`, so on a vault that never declared it this
command exits 2 saying so.

The guard ([`src/db/guard.ts`](../../src/db/guard.ts)) is a security boundary, not
a parser, and is tested by what it refuses:

- exactly **one** statement, so everything after the first semicolon is refused;
- starting with `SELECT` **or** `WITH` — `WITH x AS (...) SELECT ...` is ordinary
  SQL and is accepted, which is why the keyword scan below runs over the whole
  statement rather than the first token;
- no mutating or transaction-control keyword anywhere in it;
- no name in the reserved `pragma_` or `sqlite_` namespaces, table-valued
  functions included
  ([ADR 0090](../decisions/0090-query-guard-refuses-reserved-namespaces.md));
- string literals, quoted identifiers and comments are neutralized before any of
  the above, so a keyword inside a string cannot confuse them.

A refusal is a usage error (code 2), and so is SQL the database itself rejects.

**`--schema`** reports the tables and views with their columns, and runs no
statement — passing both is a usage error (code 2). It answers the question a
caller has to answer before it can write any SQL at all, and it answers it from
the database rather than from a copy of the schema kept somewhere else, which is
the only version that cannot drift. Columns of a computed view expression carry
no `type`, because SQLite declares none. Like any other `query`, it needs
`data/log.db` to exist.

### `gamereg vocab`

```
gamereg vocab
gamereg vocab --locale pt-BR --json
```

Reports the register's own vocabulary in the active locale, in eight groups:
`register` (the register's own acts — *filed*, *approved*, *archived*, *pending
clarification*, *certified copy*), `entity` (game, run, session, break, verdict),
`outcome`, `status`, `completion_criteria`, `difficulty`, `form` and `mode`.
Reads no log, writes no event, and works outside a vault.

It exists for the agent ([05-agent](05-agent.md#language)). JSON output is neutral
by contract — the Registrar's voice lives in prose, which an agent behind a pipe
never receives — so every word the user reads in a chat is one the model chose.
A result carrying `"difficulty": "hard"` or `"criteria": "true_ending"` leaves
the model to translate a token it has no table for, and the register's own acts
are worse still: nothing in a JSON result names them at all.

**It reports `vocab` and nothing else — words, never sentences.** A sentence
template can be filled in and passed off as CLI output; a word cannot. That
boundary is what makes this safe to hand to a model, and it is enforced by test
rather than by convention: no placeholder in the block, every locale covering the
same terms, every enum token carrying one, and no other block of the bundle
travelling with it. See
[ADR 0019](../decisions/0019-agent-gets-words-not-sentences.md).

## Attachments

`--photo <path>` is **repeatable**, and `--caption` captions the `--photo`
immediately before it — pairing follows the order they were typed in, not the
order commander accumulated them:

```
gamereg end --photo ending.jpg --caption "credits rolled" --photo stats.jpg
gamereg start "chrono trigger" --photo box.jpg --kind box --as-cover
```

| Flag | Effect |
|---|---|
| `--photo <path>` | Attach a file. Repeatable. A path that does not exist, or is not an image, exits 2 |
| `--caption <text>` | Caption for the preceding `--photo`. Repeatable, positional |
| `--kind <k>` | `screenshot` \| `photo` \| `box` \| `media` \| `other` (default). One value for every photo of the invocation |
| `--as-cover` | Also promote the first photo to the game's cover, `source: user` |

Which commands take which:

| Command | `--photo` | `--caption` | `--kind` | `--as-cover` |
|---|---|---|---|---|
| `start`, `end`, `finish`, `drop`, `past` | yes | yes | yes | yes |
| `attach` | yes | yes | yes | no |
| `cover` | yes | no | yes | no |
| `break start`, `break end`, `verdict` | no | no | no | no |

`--as-cover` on `start` is the answer to "I own the cartridge, use my photo, not
the database's". It writes both an attachment and a `game.cover` event, and
`enrich` will not override it afterwards (invariant 11,
[ADR 0024](../decisions/0024-user-covers-are-never-replaced.md)). Passing it with
no `--photo` in the same command is a usage error (code 2).

GPS and the rest of EXIF are stripped on ingest, and are not configurable back on
(invariant 12). A photo's own capture time is reported as a suggestion when
`--at` did not already answer the question; it never sets the timestamp by itself.
What `--kind` means beyond storage is
[ADR 0026](../decisions/0026-photo-kind-drives-cover-and-form.md).

### `gamereg attach <target> --photo <path>`

```
gamereg attach 01K... --photo ending.jpg --caption "..." --kind screenshot
gamereg attach "chrono trigger" --photo box.jpg --kind box
```

Retroactive attachment. `<target>` is an event id already on record, or — when no
event has that id — a game query, in which case it attaches to the game rather
than to a moment. The query resolves against existing entries only; nothing
matching exits 4. At least one `--photo` is required (code 2).

### `gamereg cover <query>`

```
gamereg cover "chrono trigger" --photo box.jpg          # from a file
gamereg cover "chrono trigger" --from e3b0c442...       # promote an attachment
gamereg cover "chrono trigger" --reset                  # back to provider art
gamereg cover "chrono trigger" --id game:01K... --reset
```

Exactly one of `--photo`, `--from` or `--reset` — none of them, or more than one,
is a usage error (code 2). `--from` takes the sha256 of an attachment already on
this game's timeline; any other hash exits 4.

`--photo` ingests the file, files an `attachment.add` against the game and a
`game.cover` with `source: user`. `--reset` appends a `game.cover` with
`source: provider`; it deletes nothing, and the user photo remains an attachment
on the timeline. Only `--reset` undoes a user cover — enrichment never does
(invariant 11).

## Platform vocabulary

`platform` stays free text everywhere it already is. [01-model](01-model.md)
deliberately never lists it as a controlled vocabulary, and
[03-resolution](03-resolution.md#the-platform-hint-filters-it-does-not-resolve)
is unaffected. **Nothing here rejects a value.** What it does is *canonicalize*
one spelling onto another, and *order* what gets offered — so that a register
kept for years does not end up holding `SNES`, `Super Nintendo` and
`supernes` as three different platforms, which is how the data gets poor
([ADR 0005](../decisions/0005-platform-list-is-not-a-validator.md)).

### Names and synonyms

A platform is a canonical name plus the spellings that mean it:

```jsonc
"platforms": [
  "PlayStation 5",
  { "name": "Mega Drive", "aliases": ["Genesis", "Megadrive", "MD"] }
]
```

A bare string is shorthand for `{ "name": "...", "aliases": [] }`; both forms
are legal in the same array, and `platform add` writes whichever the entry
needs. Comparison is by `normalize()` — the same function `game.alias` uses —
while the stored text keeps the casing that was typed. Compare normalized,
keep the literal.

`gamereg.config.json` carries `platforms`, default `[]`, alongside
`defaults.platform`. It is vault **configuration**, not event-sourced state:
nothing that writes to it appends an event, the same way `init` itself never
touches `data/events.jsonl`.

A **built-in table** ships with the CLI: the common platforms and their
synonyms, *including the spellings the providers use* — "Nintendo Switch",
"PC (Microsoft Windows)", "Super Nintendo Entertainment System". Those
provider spellings are what let the catalog intersection below work by string
comparison, with no table of provider platform ids to keep in sync. They are
also what a provider is *asked* with: resolution step 6 narrows a catalog
search by every spelling of the hinted platform, so a missing provider spelling
is not merely a missed intersection — IGDB writes it
"Sega Mega Drive/Genesis" and "Sega Master System/Mark III", and neither half
of a slash matches on its own
([ADR 0021](../decisions/0021-platform-hint-narrows-provider-query.md)). The
table:

- seeds `init`'s suggestions, and supplies the synonyms for a name added
  without any;
- is **never a validator**. A platform absent from it is accepted verbatim,
  and joins `config.platforms` on first use;
- is **data, not interface text**. Platform names are proper nouns —
  "Nintendo 64" is not translated into anything. It lives with the rest of
  the vocabulary under `src/core/`, not in `i18n/`; only the prompt labels and
  the "Other" choice come from `i18n/`. This is the one place the
  no-hardcoded-English rule does not apply
  ([ADR 0010](../decisions/0010-platform-names-are-data.md)).

One entry is curated the other way round, and it is a judgement rather than a
spelling: **`Steam Deck` is filed as a synonym of `PC`.** No catalog carries the
Deck as a platform of its own, so an entry of its own could be named and never
look anything up. Because canonicalization runs on read as well as on input, this
reaches the register and not only the search: a run recorded on the Deck reads as
`PC` in the notes, the table and the SQLite cache, retroactively. A vault that
wants the distinction back declares `Steam Deck` in `config.platforms`, where the
user's own entry wins as always
([ADR 0022](../decisions/0022-steam-deck-is-pc.md)).

### Canonicalization happens at two boundaries

One pure function over an input and the table, applied in two places:

1. **On input.** A `--platform` flag, a menu choice, an agent's argument, an
   `amend --set platform=…` patch. `SNES` becomes `Super Nintendo` before it
   becomes an event payload. New data is clean at rest.
2. **On read.** Once per build, over a copy of the folded state, before any
   target plans anything. Not in `render/`, and not in the targets themselves —
   a single pass is what keeps every target agreeing with every other.

Lookup order inside it: `config.platforms` first, the built-in table second,
verbatim last. **The user's own entry always wins.** Someone who prefers
`Genesis` over `Mega Drive` says so once, in their config, and the built-in
table stops having an opinion about that platform. Someone who types a
platform neither knows gets it recorded exactly as typed.

The second boundary is not redundant with the first; it is the retroactive fix.
Adding `Megadrive` as a synonym today makes forty runs recorded in 2019
display as one platform, with no `event.amend` and without a single line of
the log being rewritten. Invariant 1 stays intact and the log stays
honest about what was actually typed. Canonical input is a fixed point of the
function, so applying it twice costs nothing
([ADR 0011](../decisions/0011-canonicalize-platforms-on-input-and-read.md)).

Two consequences to respect:

- **`fold` stays pure over events** and does not read the table. Read-time
  canonicalization belongs to the build's planning step, which already receives
  the config — invariant 8 is satisfied, not bent.
- **The `sqlite` target stores both**: `platform` (canonical) and
  `platform_raw` (as recorded). `query` reads the canonical column; the raw
  one exists so a bad canonicalization is always visible and never
  destructive.

### What gets offered, and when nothing is asked

Wherever a platform is chosen interactively, the list is built the same way,
and **nothing is ever filtered out** — the grouping *is* the mechanism:

| Group | Content | Why it is there |
|---|---|---|
| 1 | `game.platforms` ∩ `config.platforms` | the likely answer |
| 2 | the rest of `game.platforms` | a console that isn't yours — a cousin's, a rental, a demo kiosk |
| 3 | the rest of `config.platforms` | an emulator, an FPGA board, a fan port, a handheld the catalog never lists |
| 4 | `Other` | free text |

**Only a platform the user *typed* joins `config.platforms`** — under "Other" at
a closing prompt, or via `--platform` on `start`, `end`, `finish` or `drop`. A
platform picked out of group 2 is frequently someone else's console, and filing
it as one of yours would quietly degrade every intersection after it. Group 1 and
group 3 picks are already on the list by definition. `past --platform`,
`import`'s `platform` column and `amend --set platform=…` are canonicalized like
everything else but never add to the list.

Within each group, order by how many runs already use that platform. The
count comes from the folded state, so it needs no new config field and no
bookkeeping.

Two different kinds of empty must not be confused:

- **The game was never enriched.** `game.platforms` is empty, groups 1 and 2
  with it, and the list is just `config.platforms` + `Other`. There is no
  catalog to reason from.
- **The game was enriched and the intersection came out empty.** The catalog
  leads the list, because an empty intersection is *evidence*: the answer is
  probably a console the user does not own. Offering their own platforms
  first here would be offering the set we already know does not match.

Group 3 is why the catalog does not simply replace the user's list. A Steam
Deck owner intersects with "PC (Microsoft Windows)" on approximately no
game; without group 3 they would retype it forever.

**A group 1 with exactly one member resolves without asking.** That is the
payoff of the whole design: one owned platform that matches the catalog means
the question has one answer, and neither a human nor an agent should be made
to confirm the obvious.

It is still an inference from ownership — the cousin's Switch is real — so it
is stated rather than performed silently. The prose says which platform was
chosen and why, and every command that settles a platform on a run it is
opening or closing reports `platform_source` in its JSON result:

| Value | Meaning |
|---|---|
| `flag` | `--platform` |
| `last_run` | the previous run of this game |
| `config_default` | `defaults.platform` |
| `intersection` | group 1 had exactly one member |
| `prompt` | the user picked it, or typed it under "Other" |

An agent that reads `intersection` knows it may want to confirm; one that
reads `prompt` knows it must not. When the inference was wrong, the fix is an
`event.amend`, the same event the late fill uses.

### `gamereg platform add|remove|list`

```
gamereg platform add "Mega Drive" Genesis Megadrive MD
gamereg platform remove "Mega Drive"
gamereg platform list
```

Subcommands, same shape as `gamereg break start|end`. They rewrite
`gamereg.config.json` directly, like `init`, and touch nothing else — no
event, ever. Under `--dry-run` they report the result and write nothing.

`add` takes the canonical name as the first positional and any number of
synonyms after it; given none, and only for a name that is not on the list
yet, the built-in table supplies them when it knows the name. It is
idempotent, dedup by `normalize()` across names **and** synonyms: one machine
never ends up with two entries.

Adding a name that already *means* an existing platform **renames** that
entry, and the name it replaces stays on as a synonym — `platform add
Genesis` turns the `Mega Drive` entry into a `Genesis` one that still answers
to `Mega Drive`, `Megadrive` and `MD`. A re-spelling of the same name
(`3do` → `3DO`) is a correction, not a rename, and leaves no synonym behind.
Re-adding an existing name with new synonyms merges them in.

`remove` is a no-op, not an error, when the name isn't there. It only edits a
suggestion list; nothing it removes was ever load-bearing, and runs already
recorded on that platform keep it.

`list` prints the configured platforms with their synonyms and the number of
runs behind each. It exists because an agent has to know what to offer before
it can offer anything, and because it is the fastest way to spot a synonym
that should have been merged.

There is no `rename` subcommand: `add` already is one, per above, and
canonicalization-on-read makes the history follow along without an amend.

### Seeding the list at `init`

`gamereg init --platforms switch,pc,...` seeds it non-interactively, comma
separated like `--targets`; each name is canonicalized and picks up the
built-in table's synonyms. Interactively (no flag, human at a terminal): a
repeated checkbox over the built-in table's platforms plus the names already
chosen, with a trailing "Other" choice. Picking "Other" prompts for a name, adds
it to the working set already selected, and re-shows the list so another can be
added. It ends when the user submits without picking "Other" again.

Seeding is a convenience, not a prerequisite. An empty `platforms` means
group 1 is always empty, so nothing auto-resolves and every close asks — the
list then grows from what gets typed, which is the same place it would have
come from anyway.

## Provider credentials

Two sources, checked in this order, first one present per key wins:

1. **Environment variables** — `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, one
   variable per credential, named `<PROVIDER>_<FIELD>`.
2. **`gamereg.secrets.json`** at the vault root, seeded empty by `init` and
   gitignored by `init`. Same shape as `gamereg.config.json`, keyed by provider:

   ```jsonc
   { "igdb": { "client_id": "...", "client_secret": "..." } }
   ```

The file exists so a vault stays runnable without exporting shell variables;
the environment variable exists so a credential never has to touch disk if the
caller (a cron host, a container) is already set up that way. Neither is
required — a provider with no credential from either source is simply
unavailable. `enrich` exits 6 naming which one is missing; `search` skips that
provider silently, because a vault with no credentials must still search locally.

Like `gamereg.config.json`, `gamereg.secrets.json` is read, never written by
anything but `init`. No command persists a credential it was handed on the
command line; there is no `--client-secret` flag for exactly that reason.

## Maintenance commands

### `gamereg init`

```
gamereg init [--locale en] [--timezone America/Sao_Paulo] [--day-cutoff 05:00]
             [--platform switch] [--form digital] [--mode solo]
             [--targets obsidian,csv] [--csv-dir data] [--platforms switch,pc]
```

Writes three files at the vault root (`--vault`, or the working directory):

| File | Policy |
|---|---|
| `gamereg.config.json` | written every time this command completes |
| `gamereg.secrets.json` | seeded empty, one field per known provider, **only if absent** |
| `.gitignore` | created, or appended with `gamereg.secrets.json` if that line is not already there |

Nothing else — every other path in
[00-architecture](00-architecture.md)'s directory listing is created lazily, by
whichever command or target first writes into it. The last two are idempotent:
re-running `init` never overwrites an existing `gamereg.secrets.json` and never
duplicates the `.gitignore` line. See *Provider credentials* above.

`--locale` is the one field with no dedicated flag: it reuses the global
`--locale`, which already picks the invocation's own output language, and writes
that same value into `config.locale`.

**Every key in `gamereg.config.json` is optional, and every key in it must be one
gamereg knows.** An unknown key exits 2, naming it by its full path and listing
what is valid at that level, exactly as an unknown enum value does. The two are
the same promise: a setting the register does not understand is one the user
believes is in force, and silence there is worse than a refusal. See
[ADR 0015](../decisions/0015-unknown-config-keys-exit-2.md).

**A key gamereg does know still exits 2 if its value is the wrong shape.**
`locale`, `timezone`, `defaults.platform`, `platforms`, `build.targets`,
`build.csv.dir` and every `images.*` field are checked at load, the same way
`checkin`'s own values are: a wrong type is `error.bad_config_value` naming the
key and the file, never a value quietly kept at its default. `timezone` is
checked against the IANA database, and `images.max_edge` and `images.quality`
against what the image pipeline accepts, so a bad setting fails at load rather
than later, mid-ingest, with a message naming a photo. `init --timezone` is
checked the same way before the file is written.

Each field is resolved as: the flag, then an interactive prompt seeded with the
current value, then that current value left as it stands. "The current value" is
the parsed config file when one exists, and the built-in defaults
(`DEFAULT_CONFIG`) when none does. Interactivity follows the normal resolution
(*Two independent axes* above): a human at a terminal is asked for whatever a
flag did not answer; a machine gets the current value and is never blocked, which
is invariant 14.

A vault that already has a config file is left alone: `init` exits 7
(`needs_confirmation`) and does not touch the file. `--yes` overwrites it —
and because the existing values are what seed the prompts, re-running `init`
interactively behaves like editing the config rather than resetting it.

`--targets` validates like `build.targets` elsewhere: an unknown name exits 2
listing the valid ones, and so does a target this version cannot yet build.
`--day-cutoff` must look like `05:00`. `--form` and `--mode` validate against the
vocabulary.

This command never touches `data/events.jsonl` and never appends an event —
there is no state to fold yet, only a vault to declare.

### `gamereg alias <query> --add <alias>`

```
gamereg alias "chrono trigger" --add "ct"
gamereg alias --id game:01K... --add "crono"
```

Appends a `game.alias`, so the query is answered directly from then on
([03-resolution](03-resolution.md#every-resolution-teaches)). `--add` is
required; the value is normalized before it is stored, so casing and punctuation
do not matter and cannot be preserved. `<query>` (or `--id`) must resolve to a
game already on record — this command never creates one, and nothing matching
exits 4.

Aliases are per-game and never global. Adding an alias that already points at
another game moves it, by appending, as always. Undoing one is `revoke` on the
`game.alias` event.

### `gamereg enrich [<query>] [--provider igdb] [--match <ref>] [--all] [--missing] [--covers]`

The network step, isolated — the only command that reaches the network
(invariant 5). Appends one `game.enrich` per game it resolves. Safe to run from
cron. Failure here never blocks recording: whatever succeeded is committed, and
only the exit code (6) and the JSON envelope say something did not.

`--id <ref>` names the local game by reference instead of by query, exactly as it
does elsewhere. **There is no `--force`.**

**Cover art is fetched only with `--covers`.** Without it no cover is downloaded
and none is recorded, whatever the provider returned. With it, the art goes
through the same ingest pipeline `--photo` uses; a failed download falls back to
recording the bare URL rather than failing the enrich.

**How a provider record is found**, in order:

1. If the game already carries an id for that provider — from a previous enrich,
   or from `start --id <provider ref>` — it is **fetched by id**. No lookup, and
   `<query>` changes nothing.
2. Otherwise the provider is asked for **exact title matches**, not a relevance
   search, and the results are filtered to those whose normalized title equals the
   search term's. A relevance-ranked search can bury an old, low-engagement
   release arbitrarily deep; exact matching is complete.
3. Exactly one match is fetched and applied.
4. Several matches are narrowed by the platforms **already recorded on this
   game's runs** — not `game.platforms`, which a previous enrich may have
   overwritten. Exactly one survivor resolves it outright; several leave it
   ambiguous with the platform-matching candidates first; none at all falls back
   to the unfiltered set, since the provider may simply not carry that release.

The search term is `<query>` as typed when one is given, and each game's stored
title otherwise. Edition suffixes are **not** stripped for this comparison, unlike
local resolution: a catalog lists an edition as its own entry with its own id
([ADR 0012](../decisions/0012-no-edition-stripping-for-providers.md)).

Ambiguity is a return value, not a guess: exit 3 with `candidates[]`, the same
shape as any other resolution ambiguity
([03-resolution](03-resolution.md), [ADR 0004](../decisions/0004-provider-ambiguity-is-returned.md)).
A human at a terminal gets the usual menu; a script or agent re-invokes with
`--match <provider>:<id>` to fetch that exact candidate directly, skipping the
lookup. A bulk run never prompts and never exits 3 for this — an ambiguous match
is left as-is, same as no match at all — so a cron enrich never blocks on a
question nobody is there to answer.

Mutually exclusive combinations, each a usage error (code 2):

| Combination | Why |
|---|---|
| `--match` + `--all` | `--match` names one record; `--all` names every game |
| `--missing` + `--all` | two bulk selectors |
| `--missing` + `--match` | same |
| `--missing` + `<query>` | `--missing` names its own targets |

An unknown `--provider`, or an unknown provider inside `--match`, exits 2 listing
the known ones. A `--match` reference the provider does not have exits 4.

**`enrich` reads run platforms; it never writes one.** A run left with
`platform: null` is filled by `end`, `finish` or `drop` — offline, from
whatever this command already stored on the game. The network command owns
`game.*` and the recording commands own `run.*`, and that line does not move
just because the two happen to talk about platforms
([ADR 0023](../decisions/0023-late-platform-fill-on-close-only.md)).

**Never overwrites a cover with `source: user`** (invariant 11). Only
`gamereg cover --reset` gives provider art back.

**`--missing` selects every game never actually enriched for `--provider`**
(default `igdb`) — reading folded state, no network involved in the selection
itself. It is a bulk selector, a sibling of `--all`, and it is what makes the
"safe to run from cron" line above true for an incremental run: without
`--missing`, a cron `enrich --all` re-fetches the whole catalog on every tick,
one network round trip per game already on record.

**"Missing" is keyed on whether an enrich actually completed, not on whether
a provider id is on record.** `start --id <provider ref>` resolving a `search`
hit with no local match yet creates the game from that bare reference alone
(invariant 5: no write command touches the network) — `game.providers` is set,
but no metadata was ever fetched. `--missing` still selects that game: it tracks
whether a `game.enrich` event has landed for this provider, which
`game.providers` alone does not tell it. This is what makes the reference
recorded at creation time actually get used later — the known id is fetched
directly, no lookup needed.

**With `--covers`, `--missing` also selects a game that has metadata but no
cover on record.** A game enriched before `--covers` existed, or simply never
given it, has real metadata and `game.cover: null`; `enrich --missing
--covers` backfills its art the same way a fresh enrich would, without
touching games that already have a cover (`source: user` or a provider's own,
either way). Without `--covers`, cover state plays no part in selection — only
the metadata condition above does.

```json
{ "ok": false, "code": 6, "error": "provider_unavailable",
  "result": { "enriched": [{ "game_id": "...", "title": "...", "provider": "igdb" }],
              "skipped": [{ "game_id": "...", "title": "..." }],
              "failed": [{ "game_id": "...", "title": "...", "message": "..." }] } }
```

### `gamereg build [target...] [--force] [--list]`

Regenerates every derived artifact. Idempotent (invariant 2).

```
gamereg build                    # every target in build.targets
gamereg build csv                # one target, as a convenience while iterating
gamereg build obsidian csv       # a subset
gamereg build --list             # what this vault declares, and what it wrote
```

**The argument narrows a build; it never defines what the vault contains**
(invariant 4). Which targets exist is `build.targets` in `gamereg.config.json`,
defaulting to `["obsidian"]`. Exit 2 for an unknown target name, for a target
this version cannot yet build
([ADR 0046](../decisions/0046-unbuilt-targets-list.md)), and for a valid target
this vault has not declared — the argument may only narrow what is already there.

`--force` rewrites every derived file whether it changed or not, and is the only
path that overwrites a file written under the `seed` policy — the seeded
`Game Database.base` in each tree, and `quartz/quartz.config.yaml`. See
[07-targets](07-targets.md#write-policies).

`--list` neither plans nor writes: it reports the declared targets and what the
manifest records each of them as owning.

A target that fails does not stop the others: the build finishes, reports what
failed, and exits 1 having written everything that worked — the same principle as
code 6, where local work is committed even though the network step was not.
Deletion stays a manifest whitelist (invariant 9,
[ADR 0030](../decisions/0030-deletion-is-one-manifest-whitelist.md)).

**Two `build` processes never write the same vault at once.** Planning is
read-only and needs no lock; the write phase takes one, backed by a lockfile
at `.gamereg/build.lock` holding the holder's PID. A second `build` that
starts while the first is still writing exits 5 (conflict) rather than racing
it — `data/log.db` in particular has no atomic rename-into-place, so a torn
concurrent write could leave `query` unable to open it at all, not just read
something stale. A lock left behind by a process that no longer exists (killed,
crashed, the machine restarted) is detected as stale and cleared automatically
before the next build proceeds — nothing to clean up by hand.

```json
{ "ok": false, "code": 1, "error": "target_failed",
  "result": { "written": ["obsidian/Game List.md"], "removed": [],
              "failed": [{ "target": "sqlite", "message": "..." }] } }
```

See [04-derived](04-derived.md) for the artifacts and
[07-targets](07-targets.md) for the target contract.

### `gamereg amend <event_id> --reason "..." [--set k=v ...]`
### `gamereg revoke <event_id> --reason "..."`

Both append. Neither touches the original line (invariant 1). `--reason` is
required on both. An id no event carries exits 4.

`--set` is repeatable and at least one is required (code 2). A value is parsed as
JSON when it parses and kept as a string otherwise, so `--set rating=9` writes a
number and `--set note=hello` writes a string. A `platform` value is
canonicalized on the way in, like every other platform input.

**A `--set` key the target event's type does not carry is refused (exit 2), and
the message lists the fields it does carry.** The fold takes each field from the
event that owns it, so a foreign key would be merged into the payload, read by
nobody, and reported as a success — `--set rating=9` on a `run.open` is discarded
by the `run.close` that follows it. Derived state (`minutes`, `hours_source`) is
refused for the same reason: it is computed, never stored (invariant 7). See
[ADR 0094](../decisions/0094-amend-refuses-foreign-keys.md).

The enforced list is [`EVENT_FIELDS`](../../src/core/events.ts), which is
[01-model](01-model.md#event-types)'s payload tables plus the three keys the
writers add on top of them — `at`, `attachments` and `date_precision`.

`amend` refuses to target an `event.amend` or an `event.revoke`: a correction is
corrected by revoking it, not by correcting the correction. `revoke` has no such
restriction — it is the way back out of anything, including an amend.

The consequence for a caller is that a run has **two** correctable events, and
which one an `amend` takes depends on the field. `gamereg status` reports both
as `run_open_event_id` and `run_close_event_id`; the second is `null` until the
run closes, and equals the first for a run filed by `past --ended` or by
`import`. See [ADR 0065](../decisions/0065-status-exposes-correctable-event-ids.md).

Neither command is behind a platform approval gate; confirmation is
conversational ([ADR 0008](../decisions/0008-amend-revoke-confirmed-in-conversation.md)).

### `gamereg import <file.csv> --mapping <file.json>`

Bulk historical import, for people arriving from a spreadsheet. Emits one
`run.import` per row (plus one `run.verdict` for a row that maps `verdict` —
[ADR 0057](../decisions/0057-imported-verdict-is-its-own-event.md)).
`--mapping` is required. `--dry-run` is strongly recommended — see the warnings
below on what an import gets wrong permanently if it isn't checked first.

```
gamereg import games.csv --mapping mapping.json [--dry-run]
```

**The mapping file** is a flat JSON object: gamereg field name → the CSV's own
column header for that field. A field absent from the mapping, or mapped to an
empty string, is simply not imported. A mapping that is not a JSON object, or
that has no column for a required field, exits 2 before any row is read. There is
no shipped example mapping; a worked one lives in the import guide
([ADR 0056](../decisions/0056-import-mapping-example-in-the-guide.md)).

```json
{
  "title": "Title",
  "ended": "Finished",
  "started": "Started",
  "hours": "Hours",
  "rating": "Rating",
  "verdict": "Review"
}
```

| Field | Required | Accepts |
|---|---|---|
| `title` | yes | Free text — the query resolution matches or creates from, same as `past`'s argument. |
| `ended` | yes | `2011`, `2011-07` or `2011-07-14` — precision is inferred from the shape, same as `past --ended`. |
| `started` | no | Same shape rule as `ended`. Defaults to `ended` when omitted. |
| `hours` | no | A decimal number, e.g. `42.3`. **Decimal point only** — see below. |
| `rating` | no | An integer 0–11, or `none`. |
| `difficulty` | no | One of the vocabulary's difficulty tokens. |
| `criteria` | no | One of the vocabulary's completion-criteria tokens. |
| `outcome` | no | One of the vocabulary's outcome tokens. |
| `platform` | no | Free text, canonicalized like everywhere else. **A mapped column, not a flag** — `import` has no `--platform`. |
| `form` | no | One of the vocabulary's form tokens. |
| `mode` | no | One of the vocabulary's mode tokens. |
| `note` | no | Free text — what the run itself says. |
| `verdict` | no | Free text — the considered opinion, filed as a separate `run.verdict` event against the same run. |

An empty cell is the same as an unmapped field. Every row needs a non-empty
`title` and `ended`; a row missing either fails as a row, not as an import.

Valid tokens for `difficulty`, `criteria`, `outcome`, `form` and `mode` are not
repeated here — they are the register's own vocabulary and drift the moment
they are copied. Ask `gamereg vocab --json` (see
[D9](00-architecture.md#d9--capability-is-introspectable-never-a-list-the-caller-keeps)
and [05-agent](05-agent.md#language)).

**Number format is not negotiable.** `hours` accepts a plain decimal point —
`12.5`, not `12,5`. `1,500` is ambiguous between a thousands separator and a
comma decimal, and the log has to be readable in ten years regardless of which
locale exported the spreadsheet; a comma-decimal cell fails that one row with
"must be a positive number" rather than being guessed at. Reformat the column
before importing, not after.

**Resolution is entirely offline** (invariant 5): no provider is reached, and an
unmatched title becomes a new local entry — `import` always resolves as if
`--no-metadata` had been passed, since a bulk import has nobody to ask. That is
the one way it differs from `past`, which refuses instead unless the flag is
given. Run `gamereg enrich --missing --covers` afterwards to fetch metadata and
art for whatever the import created.

**A row that fails does not stop the import.** Each row is resolved and
staged independently; a bad row is reported by its 1-indexed line number
(header is line 1) and everything that succeeded is still committed. The
command exits 0 only when every row succeeded, 1 when some failed (with
`result.failed[]` naming which), and 2 for a usage error that stops before any
row is processed — an unreadable file, or a mapping missing a required field.

```json
{ "ok": false, "code": 1, "error": "import_row_failed",
  "result": { "imported": [{ "row": 2, "game_id": "...", "run_id": "...", "title": "..." }],
              "failed": [{ "row": 12, "message": "..." }] } }
```

**Two things a fast `--dry-run` check does not surface, so read them once
before running for real:**

- **A bad row leaves permanent residue.** An unmatched title becomes a new
  local game the same instant it's filed, and once a title exists locally,
  `search` stops asking a provider about it at all. Two hundred badly resolved
  rows are two hundred phantom games that go on answering silently forever —
  undoing that is `revoke`, one event at a time. `--dry-run` computes
  everything an import would do and writes nothing; run it first, read the
  titles it resolved to, and only then import for real.
- **Imported years show up empty in the heatmap and the year in review.** A
  `run.import` has no sessions, and a session is what carries a logical day —
  see [04-derived](04-derived.md#heatmap-and-year-in-review) and
  [ADR 0048](../decisions/0048-year-hours-are-measured.md). The Stats page will
  show gaps for years that were, in reality, entirely played. That is not a bug:
  those hours are stated (`hours_source: stated`), never measured, and the
  register never invents the days they happened on.

### `gamereg doctor`

Validates the log and the derived tree. Reports; does not fix. Exit 1 if
anything is wrong, and the problems go to stderr in prose mode and to
`details.problems[]` under `--json`.

Read of the log, tolerantly — a malformed line is reported rather than thrown, so
one pass describes every problem:

- a line that is not JSON, or not a JSON object;
- a line missing `id`, `ts` or `type`, carrying an unknown event type, or with no
  `data` object;
- a timestamp that cannot be read.

Over the folded state:

- a game, run or session created or opened more than once;
- a run or a session closed more than once;
- a session that closes before it opens, or a duration that works out negative;
- a break outside an open session, or a second break opened while one is open;
- an event that points at something that does not exist (an orphan reference);
- an event missing a field its type requires;
- a slug shared by more than one game.

Over the payloads as written:

- an unknown token in `outcome`, `completion_criteria`, `difficulty`, `form` or
  `mode` — `session.checkin` is checked against the check-in outcomes rather than
  the run outcomes, since the two vocabularies share the field name;
- a `rating` that is not an integer from 0 to 11.

Over the derived artifacts:

- a marker block in a note that this version does not write;
- prose in a run note outside the markers, which the next build would lose;
- a file that looks generated but no target owns;
- two targets planning the same path, and a target that cannot plan at all.

## Command name mapping (pt-BR)

Shipped in `i18n/pt-BR.json`. Both spellings always work regardless of locale —
locale sets the *output* language, not the accepted input.

| English | pt-BR |
|---|---|
| `start` | `iniciar` |
| `end` | `encerrar` |
| `break` | `intervalo` |
| `finish` | `finalizar` |
| `drop` | `abandonar` |
| `past` | `historico` |
| `search` | `buscar` |
| `open` | `abertas` |
| `due` | `pendencias` |
| `checkin` | `conferir` |
| `status` | `situacao` |
| `build` | `construir` |
| `doctor` | `auditoria` |
| `alias` | `apelido` |
| `amend` | `corrigir` |
| `revoke` | `revogar` |
| `enrich` | `enriquecer` |
| `verdict` | `parecer` |
| `init` | `inicializar` |
| `platform` | `plataforma` |
| `add` | `adicionar` |
| `remove` | `remover` |
| `list` | `listar` |
| `vocab` | `vocabulario` |
| `query` | `consultar` |
| `import` | `importar` |
| `attach` | `anexar` |
| `cover` | `capa` |

Flags are localized the same way:

| English | pt-BR | | English | pt-BR |
|---|---|---|---|---|
| `--at` | `--em` | | `--reason` | `--motivo` |
| `--timezone` | `--fuso` | | `--no-metadata` | `--sem-metadados` |
| `--day-cutoff` | `--corte-do-dia` | | `--dry-run` | `--simular` |
| `--targets` | `--alvos` | | `--yes` | `--sim` |
| `--csv-dir` | `--pasta-csv` | | `--vault` | `--acervo` |
| `--note` | `--anotacao` | | `--locale` | `--idioma` |
| `--rating` | `--nota` | | `--quiet` | `--silencioso` |
| `--difficulty` | `--dificuldade` | | `--non-interactive` | `--nao-interativo` |
| `--criteria` | `--criterio` | | `--local-only` | `--somente-local` |
| `--platform` | `--plataforma` | | `--add` | `--adicionar` |
| `--platforms` | `--plataformas` | | `--set` | `--definir` |
| `--form` | `--formato` | | `--force` | `--forcar` |
| `--mode` | `--modo` | | `--all` | `--tudo` |
| `--break` | `--pausa` | | `--missing` | `--faltando` |
| `--hours` | `--horas` | | `--match` | `--correspondencia` |
| `--started` | `--inicio` | | `--provider` | `--provedor` |
| `--ended` | `--fim` | | `--covers` | `--capas` |
| `--replay` | `--rejogo` | | `--message` | `--mensagem` |
| `--text` | `--texto` | | `--run` | `--jogatina` |
| `--id` | `--referencia` | | `--outcome` | `--resultado` |
| `--trigger` | `--gatilho` | | `--expire` | `--expirar` |

**These flags have no pt-BR spelling yet** and are typed in English in every
locale: `--json`, `--past-hours`, `--photo`, `--caption`, `--kind`,
`--as-cover`, `--list`, `--schema`, `--mapping`, `--from`, `--reset`, and the
short forms `-V`, `-h`, `-q`, `-m`.

Argument placeholders are localized in help output only: `query` → `consulta`,
`term` → `termo`, `event_id` → `id_evento`, `session_id` → `id_sessao`,
`platform_name` → `nome_da_plataforma`, `platform_synonyms` → `sinonimos`.
