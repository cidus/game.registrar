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
pipe gets JSON and never blocks, and neither has to ask.

### Interactivity resolution

Prompting is allowed only when *all* of these hold:

1. `process.stdin.isTTY` **and** `process.stdout.isTTY`
2. `--non-interactive` was not passed
3. `--json` was not passed (JSON output plus a prompt is incoherent)
4. `GAMEREG_NON_INTERACTIVE` is unset
5. `CI` is unset

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

## Exit codes

| Code | Name | Meaning |
|---|---|---|
| 0 | ok | |
| 1 | error | Unexpected failure |
| 2 | usage | Bad arguments, unknown enum value |
| 3 | ambiguous | Multiple candidates; `candidates[]` is populated |
| 4 | not_found | No candidate at all |
| 5 | conflict | State conflict (session already open, no session to close, a build already running) |
| 6 | provider_unavailable | Network or provider failure; local work was still committed |
| 7 | needs_confirmation | Destructive; re-run with `--yes` |

Code 3 is the backbone of the agent flow. See [03-resolution](03-resolution.md).

## Global flags

| Flag | Effect |
|---|---|
| `--json` | Force JSON output. Implies `--non-interactive`. |
| `--non-interactive` | Never prompt. Return candidates and exit instead. |
| `--yes` | Pre-answer confirmations (exit code 7). Not related to prompting. |
| `--vault <path>` | Override vault root (default: `$GAMEREG_VAULT` or cwd) |
| `--locale <tag>` | Override locale |
| `--dry-run` | Compute and print the events that would be appended; write nothing |
| `--at <time>` | Override the semantic timestamp (see below) |
| `-q, --quiet` | Suppress prose; exit code only |

### Time parsing for `--at`

Accepts, in this order: full ISO 8601; `YYYY-MM-DD HH:MM`; `HH:MM` (today, or
yesterday if that would place it in the future beyond `day_cutoff`); `-90m`,
`-2h` (relative to now). Ambiguity resolves toward the past — you file things
after they happen, never before.

### Environment

| Variable | Effect |
|---|---|
| `GAMEREG_VAULT` | Vault root, when `--vault` is not passed |
| `GAMEREG_NON_INTERACTIVE` | Never prompt. What a gateway sets once, per above |
| `GAMEREG_SOURCE` | The envelope's `source` on every event this invocation appends: `cli` (default), `chat`, `cron`, `import` |
| `GAMEREG_LOCALE` | Output language, when neither `--locale` nor `config.locale` is set |

`GAMEREG_SOURCE` is validated against the vocabulary, and an unknown value is a
usage error (code 2) rather than a value that gets written. It is the one part
of the event envelope supplied from outside, and the log is append-only: a typo
here would be recorded permanently on every event of that invocation, and no
later command could take it back.

## Recording commands

### `gamereg start <query>` — open a session

```
gamereg start "hollow knight" [--id igdb:7346] [--platform switch]
                              [--form digital] [--mode solo] [--replay]
                              [--past-hours 30] [--at 20:14] [--no-metadata]
```

Behaviour:
1. Resolve `<query>` to a game (see 03).
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
`gamereg amend`. See 01-model.md's *Duration* for how a stated baseline and
measured sessions add up on the same run, and `past`'s section below for the
sibling command that does the same thing without opening a session.

Conflict (code 5) if a session is already open for that run. If a session is open
for a *different* game, that is not an error — parallel runs are allowed and
common. The Registrar mentions it, and the result carries **`also_open`**: one
entry per session still open elsewhere, with `session_id`, `run_id`, `game_id`,
`title` and `started_at`. Absent when there is none.

That field exists because the prose alone cannot serve a caller that never sees
prose. Opening a session while another is open usually means the person switched
games rather than started playing two, so an agent needs both the fact and the
ids to offer closing the other one (05-agent.md). It stays an offer: `start`
never closes anything, and someone genuinely playing two games in an evening is
not doing anything the register objects to.

Metadata enrichment does **not** happen here. `run.open` writes only what is
known locally; `gamereg enrich` runs afterwards, possibly from cron. A start
command must never fail because IGDB is down.

**Platform is not required to start.** Resolution order is `--platform` → the
game's last run → `config.defaults.platform` → a single-member catalog
intersection (*Platform vocabulary* below). When none of those answer,
`run.open` is staged with `platform: null` and the session opens anyway. No
prompt, no exit 2. `error.platform_required` does not exist.

That is deliberate: starting to play is the one moment where a question is
pure friction, and it is also the moment when the answer is least informed —
the game may not have been enriched yet, so there is no catalog to narrow
anything with. `end`, `finish` and `drop` ask instead, and by then there
usually is one. See *Platform, when a run closes* below.

`--platform` is never validated against a list. It is canonicalized
(*Platform vocabulary*) and recorded as given.

### `gamereg end [<query>]` — close a session

```
gamereg end [--at 23:52] [--break 40m] [--note "..."] [--photo path.jpg]
            [--platform switch]
```

`<query>` is optional and usually omitted: with exactly one open session, it is
implied. With several open, omitting it returns code 3 listing the open sessions.

`--break` accepts `40m`, `1h20`, `90`. Additive with logged breaks.

### `gamereg break start|end`

Opens or closes a break inside the current open session. Code 5 if no session is
open, or if a break is already open.

### `gamereg finish <query>` — close a run

```
gamereg finish "hollow knight" --rating 9 --difficulty hard
                               --criteria true_ending [--at ...] [--note "..."]
                               [--platform switch]
```

If a session is still open, close it first at `--at` (or now), then append
`run.close` with `outcome: finished`.

`--rating` accepts 0–11 or `none`. `--criteria` and `--difficulty` validate
against the vocabulary; an invalid token exits 2 and lists valid ones.

This command does **not** write the consolidated verdict. That arrives separately,
whenever the words do, via `gamereg verdict`.

### `gamereg drop <query>` — abandon a run

Same as `finish` but `outcome: abandoned`, `--criteria` defaults to `abandoned`,
`--rating` optional, `--reason` free text.

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
amend's `reason` names which command settled it. It is also the correction
path when a `platform_source: "intersection"` resolution turns out wrong.

This is entirely offline. `game.platforms` comes from the folded state,
whatever a previous `enrich` left there; a run closed for a game that was
never enriched simply keeps `null`, and nothing reaches the network to avoid
that. Non-negotiable 4 holds without exception, and `enrich` never writes to
`run.*` — the two commands stay on their own sides of the line.

### `gamereg past <query>` — file a game run started in the past

```
gamereg past "chrono trigger" --ended 2011-07 --rating 10
             [--started ...] [--hours 30] [--criteria credits] [--note "..."]
             [--platform snes]

gamereg past "opus magnum" --hours 30 [--started 2026] [--platform steam]
```

**With `--ended`** (as always): emits `run.import`, a closed run whose hours
are stated. Date precision is inferred from the shape of the argument: `2011`
→ year, `2011-07` → month, `2011-07-14` → day.

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

`--started`, omitted here, defaults to the current year rather than to
`--ended` (there being no `--ended` to default to) or to today — "I don't
remember when I started" is the common case this command exists for, and a guessed
exact day would be a lie the way `run.import`'s date-precision rule already
refuses to tell. Give `--started` and it is used exactly as typed, at
whatever precision its shape implies.

`past` files a run that is already closed, frequently several in a row, so it
does **not** prompt for a platform the way `end`/`finish`/`drop` do — true for
both forms above. `--platform` is how you say it; omitted, it stays `null`
and can be amended later. The value is canonicalized like everywhere else.

### `gamereg verdict <query>` — file the consolidated review

```
gamereg verdict "hollow knight" -m "Started as a curiosity and turned into..."
gamereg verdict "hollow knight" --text review.md
gamereg verdict "hollow knight" --text -          # stdin
gamereg verdict "hollow knight" --run 01K...      # a specific playthrough
```

Appends `run.verdict`, which the build renders into the `verdict` block of the
game note. Prose enters as content, never as structured fields — no number in
the register is ever derived from it.

The text comes from `-m/--message`, from `--text <file>`, or from stdin (`--text -`,
or no flag at all when stdin is a pipe). Typing it yourself and piping it in from
somewhere else are the same operation as far as this command is concerned.

`--run` names the playthrough. Omitted, it targets the most recently ended run,
falling back to the open one when nothing has ended yet — so a verdict written
right after `finish` lands where it is meant to, even if a replay is already
under way.

Filing again replaces the previous verdict in the fold. The earlier text stays in
the log, as everything does.

## Query commands

### `gamereg search <term>`

```
gamereg search "zelda" [--platform switch] [--provider igdb] [--local-only]
```

Never writes. Returns candidates in the same shape used by code 3. This is what
the agent calls when it wants to look something up without recording anything.

A local match answers on its own; only an empty local result falls through to
provider search — resolution step 6 (03-resolution.md), which lives here and in
no write command. `--provider` narrows that fallback to a single catalog and
rejects an unknown name as a usage error, exactly as on `enrich`; with no
`--provider`, every configured provider is tried in order. `--local-only` skips
step 6 altogether, which also makes `--provider` moot.

### `gamereg open` — list open sessions

The row carries `last_checkin_id`, the `session.checkin` event most recently
filed against that session, or `null`. It is there for one caller: the agent,
answering a check-in. The wrapper files the record *after* enqueueing the wake,
so the id cannot travel with the question — this is the way back to it. A
closed session is not listed, so an answer that closes one reads the id first.

### `gamereg due [--at <time>]`

Evaluates every check-in trigger against currently open sessions and returns only
those that are **due now**: past their threshold, outside their backoff window,
and inside their delivery window. This is the entire contract with cron: run it
on a schedule, act on what comes back, say nothing when the list is empty.

Delivery windows are what let cron stay dumb. A `day_cutoff` trigger fires at
05:00 but is only *returned* from `chase_at` onward (default 09:00); a `duration`
trigger inside `quiet_hours` is held until the window ends. The CLI does this
arithmetic so every caller behaves identically — see [05-agent](05-agent.md).

`--at` evaluates as if it were another time, for testing.

```json
{ "ok": true, "result": { "due": [
  {
    "session_id": "01K...",
    "run_id": "01K...",
    "game": "Hollow Knight",
    "game_id": "01K...",
    "opened_at": "2026-08-12T20:14:00-03:00",
    "open_for_minutes": 412,
    "net_minutes": 372,
    "on_break": false,
    "break_started_at": null,
    "trigger": "duration",
    "threshold": "5h",
    "checkins_so_far": 1,
    "last_checkin_at": "2026-08-12T23:14:00-03:00",
    "last_checkin_id": "01K..."
  }
] } }
```

The row is `open`'s, plus `trigger` and `threshold`. `last_checkin_at` and
`last_checkin_id` name the same record, and it is the *previous* question — the
one this evaluation was measured against, never the one about to be asked.
`threshold` is the setting that fired, as configured: `4h` for `duration`, the
hour itself for `clock` and for `day_cutoff`.

`trigger` is what the agent uses to choose its register — see
[05-agent](05-agent.md). Never hardcode the phrasing here; the CLI reports facts.

**At most one row per session.** Several triggers can stand fired at once, and
two questions about one session is the same nagging by a longer route.
`day_cutoff` wins, being the only one chasing data it does not have; `duration`
outranks `clock`, knowing how long the session has actually run where `clock`
only knows what time it is. Several *sessions* still yield several rows, and the
agent sends one message covering them (05-agent, *One message, not N*).

Backoff and thresholds are read from config; the CLI applies them, so every
caller behaves identically and cron needs no memory of its own. The ladder is
measured from the last check-in of any trigger and indexed by how many have been
asked; the ceiling counts only `duration` and `clock`, since `day_cutoff` has its
own budget. A `day_cutoff` chase is asked once per delivery slot, which is what
bounds a trigger exempt from both.

### `gamereg checkin <session_id> --trigger <t> [--outcome <o>]`

Files a `session.checkin`. Called by **the cron wrapper, not the agent**, right
after the wake carrying the question has been enqueued. `--outcome` defaults to
`snoozed`, which is the only outcome the wrapper is ever in a position to know.
The outcome is amended later — `gamereg amend <checkin_id> --set outcome=…` — by
the agent when the user answers, or by `--expire` below when nobody does.

Where that id comes from depends on who is asking. The wrapper has it in this
command's own `result.checkin_id`. The agent does not, and cannot: the wake goes
out before this command runs, so at the moment the question reaches a
conversation the record does not exist yet. It reads `last_checkin_id` off
`gamereg open` instead, which is why that field is on the row.

A check-in never mutates the session, and a session that closed between the wake
and this call is recorded rather than refused: the question *was* asked, and
losing that fact leaves the session eligible again on the next tick.

The order is load-bearing. Enqueue the wake first, file the check-in second.
Filing first would put a session inside a backoff window having never actually
been asked, and that is the one direction this feature must not fail in. Filing
second preserves the intended failure mode — **forgetting to record a check-in
makes the assistant repeat itself, never go silent** — and a repeat costs one
extra message where a false silence costs a closing time nobody will remember.

Why the wrapper rather than the agent: the anti-nagging rules are a clock and a
counter, and invariant 7 keeps that kind of arithmetic out of a language model.
The agent's only job in a check-in is choosing the words.

### `gamereg checkin --expire`

Sweeps every check-in still `snoozed` past `checkin.reply_window` and amends it
to `no_reply`. Takes no session argument — it asks the log which records have
gone stale. Runs on the same schedule as `due`, from the same wrapper.

Silence is an answer, and this is what records it as one instead of inferring it
on read. See [01-model](01-model.md) for why that distinction is not pedantry.

### `gamereg status [<query>]`

Vault summary, or one game's state.

### `gamereg query <sql>`

```
gamereg query "SELECT title, hours FROM v_finished ORDER BY rating DESC"
gamereg query --schema
```

Runs read-only SQL against `data/log.db`. Rejects anything that is not a single
`SELECT`. This is how question-answering works — the agent writes SQL, the
database does the arithmetic, and no number is ever hallucinated.

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

Reports the register's own vocabulary in the active locale: the words for
outcomes, statuses, completion criteria, difficulties, forms and modes, plus
the terms for the register's own acts (*filed*, *approved*, *archived*,
*pending clarification*, *certified copy*). Reads no log, writes no event, and
works outside a vault.

It exists for the agent (05-agent.md, *Language*). JSON output is neutral by
contract — the Registrar's voice lives in prose, which an agent behind a pipe
never receives — so every word the user reads in a chat is one the model chose.
A result carrying `"difficulty": "hard"` or `"criteria": "true_ending"` leaves
the model to translate a token it has no table for, and the register's own acts
are worse still: nothing in a JSON result names them at all.

**It reports `vocab` and nothing else — words, never sentences.** That boundary
is the whole reason this is safe to hand to a model. A sentence template carries
`{title}` and `{time}`; a model given one can fill it in and produce something
indistinguishable from output the CLI actually emitted, which is precisely the
fabrication the JSON contract exists to prevent. A word cannot be filled in.
`test/vocab.test.ts` asserts the block stays free of placeholders, that every
locale covers the same terms, and that no other block of the bundle travels with
it.

## Attachments

`--photo <path>` is accepted by every recording command and is **repeatable**:

```
gamereg end --photo ending.jpg --photo stats.jpg --caption "credits rolled"
gamereg start "chrono trigger" --photo box.jpg --kind box --as-cover
```

| Flag | Effect |
|---|---|
| `--photo <path>` | Attach a file. Repeatable. |
| `--caption <text>` | Caption for the preceding `--photo`. Repeatable, positional. |
| `--kind <k>` | `screenshot` \| `photo` \| `box` \| `media` \| `other` |
| `--as-cover` | Also promote the first photo to the game's cover, `source: user` |

`--as-cover` on `start` is the answer to "I own the cartridge, use my photo, not
the database's". It writes both an attachment and a `game.cover` event, and
`enrich` will not override it afterwards.

### `gamereg attach <target> --photo <path>`

Retroactive attachment. `<target>` is an event id, or a game query — in which
case it attaches to the game rather than to a moment.

### `gamereg cover <query>`

```
gamereg cover "chrono trigger" --photo box.jpg          # from a file
gamereg cover "chrono trigger" --from e3b0c442...       # promote an attachment
gamereg cover "chrono trigger" --reset                  # back to provider art
```

`--reset` appends a `game.cover` with `source: provider`; it does not delete
anything. The user photo remains an attachment on the timeline.

## Maintenance commands

### `gamereg init`

```
gamereg init [--locale en] [--timezone America/Sao_Paulo] [--day-cutoff 05:00]
             [--platform switch] [--form digital] [--mode solo]
             [--targets obsidian,csv] [--csv-dir data] [--platforms switch,pc]
```

Writes `gamereg.config.json` at the vault root (`--vault`, or the working
directory). Nothing else — every other path in `docs/spec/00-architecture.md`'s
directory listing is created lazily, by whichever command or target first
writes into it. `--locale` is the one field with no dedicated flag: it reuses
the global `--locale`, which already picks the invocation's own output
language, and writes that same value into `config.locale`.

**Every key in that file is optional, and every key in it must be one gamereg
knows.** An unknown key exits 2, naming it by its full path and listing what is
valid at that level, exactly as an unknown enum value does. The two are the same
promise: a setting the register does not understand is one the user believes is
in force, and silence there is worse than a refusal — `07-targets.md` advertised
a `build.obsidian` block for four phases that nothing ever read.

Every field is optional and falls back, in order, to: the flag, an interactive
prompt, then the built-in default (`DEFAULT_CONFIG`) — the same
flag-then-prompt-then-default shape `runDefaults` already uses for `start`.
Interactivity follows the normal resolution (02-cli.md, "Two independent
axes"): a human at a terminal is asked for whatever a flag did not answer; a
machine gets the built-ins and is never blocked.

A vault that already has a config file is left alone: `init` exits 7
(`needs_confirmation`) and does not touch the file. `--yes` overwrites it —
and when it does, the existing values seed the prompts instead of the
built-ins, so re-running `init` interactively behaves like editing the config
rather than resetting it.

`--targets` validates like `build.targets` elsewhere: an unknown name exits 2
listing the valid ones, and a later-phase target exits 2 saying so.

This command never touches `data/events.jsonl` and never appends an event —
there is no state to fold yet, only a vault to declare.

`init` also seeds `gamereg.secrets.json` (empty credential fields, one per
known provider) if absent, and appends its filename to `.gitignore` at the
vault root, creating `.gitignore` if the vault has none. Both are idempotent:
re-running `init` never overwrites an existing `gamereg.secrets.json` and never
duplicates the `.gitignore` line. See *Provider credentials* below.

## Platform vocabulary

**Not implemented yet** — specified here so the shape is settled before
someone builds it.

`platform` stays free text everywhere it already is. `01-model.md`
deliberately never lists it as a controlled vocabulary, and
`03-resolution.md`'s "the platform hint filters, it does not resolve" is
unaffected. **Nothing below rejects a value.** What it does is *canonicalize*
one spelling onto another, and *order* what gets offered — so that a register
kept for years does not end up holding `SNES`, `Super Nintendo` and
`supernes` as three different platforms, which is how the data gets poor.

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
keep the literal: the principle is already in the codebase, this is one more
user of it.

`gamereg.config.json` gains `platforms`, default `[]`, alongside the existing
`defaults.platform`. It is vault **configuration**, not event-sourced state:
nothing that writes to it appends an event, the same way `init` itself "never
touches `data/events.jsonl`".

A **built-in table** ships with the CLI: the common platforms and their
synonyms, *including the spellings the providers use* — "Nintendo Switch",
"PC (Microsoft Windows)", "Super Nintendo Entertainment System". Those
provider spellings are what let the catalog intersection below work by string
comparison, with no table of provider platform ids to keep in sync. They are
also what a provider is *asked* with: 03-resolution.md's step 6 narrows a
catalog search by every spelling of the hinted platform, so a missing provider
spelling is not merely a missed intersection — IGDB writes it
"Sega Mega Drive/Genesis" and "Sega Master System/Mark III", and neither half
of a slash matches on its own. The table:

- seeds `init`'s suggestions, and supplies the synonyms for a name added
  without any;
- is **never a validator**. A platform absent from it is accepted verbatim,
  and joins `config.platforms` on first use;
- is **data, not interface text**. Platform names are proper nouns —
  "Nintendo 64" is not translated into anything. It lives with the rest of
  the vocabulary under `core/`, not in `i18n/`; only the prompt labels and
  the "Other" choice come from `i18n/`. This is the one place the
  no-hardcoded-English rule does not apply, and it is worth stating so
  nobody dutifully "fixes" it later.

One entry is curated the other way round, and it is a judgement rather than a
spelling: **`Steam Deck` is filed as a synonym of `PC`.** No catalog carries the
Deck as a platform of its own — IGDB has no such platform at all — so an entry
of its own could be named and never looked anything up on. Because
canonicalization runs on read as well as on input, this reaches the register and
not only the search: a run recorded on the Deck reads as `PC` in the notes, the
table and the SQLite cache, retroactively. A vault that wants the distinction
back declares `Steam Deck` in `config.platforms`, where the user's own entry
wins as always.

### Canonicalization happens at two boundaries

One pure function — call it `canonicalPlatform(input, table)` — applied in
two places:

1. **On input.** A `--platform` flag, a menu choice, an agent's argument.
   `SNES` becomes `Super Nintendo` before it becomes an event payload. New
   data is clean at rest.
2. **On read.** `render/`, the targets, the `sqlite` build — the same
   function over what the log already holds.

Lookup order inside it: `config.platforms` first, the built-in table second,
verbatim last. **The user's own entry always wins.** Someone who prefers
`Genesis` over `Mega Drive` says so once, in their config, and the built-in
table stops having an opinion about that platform. Someone who types a
platform neither knows gets it recorded exactly as typed, and it becomes a
`config.platforms` entry of its own.

The second boundary is not redundant with the first; it is the retroactive fix.
Adding `Megadrive` as a synonym today makes forty runs recorded in 2019
display as one platform, with no `event.amend` and without a single line of
the log being rewritten. Non-negotiable 1 stays intact and the log stays
honest about what was actually typed. Canonical input is a fixed point of the
function, so applying it twice costs nothing.

Two consequences to respect:

- **`fold` stays pure over events** and does not read the table. Read-time
  canonicalization belongs to `render/` and the targets, which already
  receive the config — non-negotiable 8 is satisfied, not bent.
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

**Only a platform the user *typed* joins `config.platforms`** — under "Other",
or via `--platform` on any command that takes it. A platform picked out of
group 2 is frequently someone else's console, and filing it as one of yours
would quietly degrade every intersection after it. Group 1 and group 3 picks
are already on the list by definition.

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
chosen and why, and every command that settles a platform reports
`platform_source` in its JSON result:

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
event, ever.

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
loop of `checkbox()` — already the pattern `askTargets()` in `init.ts` uses —
offering the built-in table's platforms plus a trailing "Other" choice.
Picking "Other" prompts `input()` for a name, adds it to the working set
already selected, and re-shows the checkbox so another can be added.
Repeatable with no new UI primitive: `@inquirer/prompts` (already a
dependency) handles this as sequential calls, same as every other prompt in
`init.ts`. It ends when the user submits without picking "Other" again.

Seeding is a convenience, not a prerequisite. An empty `platforms` means
group 1 is always empty, so nothing auto-resolves and every close asks — the
list then grows from what gets typed, which is the same place it would have
come from anyway.

Needs pt-BR command-name/flag mapping in `i18n/pt-BR.json`'s tables, the same
place `break` → `intervalo` lives. Exact wording is an implementation detail,
not specified here.

### `gamereg alias <query> --add <alias>`

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
unavailable, and `enrich` exits 6 naming which one.

Like `gamereg.config.json`, `gamereg.secrets.json` is read, never written by
anything but `init`. No command persists a credential it was handed on the
command line; there is no `--client-secret` flag for exactly that reason.

### `gamereg enrich [<query>] [--provider igdb] [--match <ref>] [--all] [--covers]`

Network step, isolated. Appends `game.enrich` and fetches provider cover art.
Safe to run from cron. Failure here never blocks recording.

`<query>` does two jobs, not one. It first resolves to a local game the
normal offline way (steps 1–5, 03-resolution.md) — a differently-spelled
query still finds the right record, since normalization treats "Pacman" and
"Pac-Man" as equal for that comparison. But the literal string is then also
what gets sent to the provider's search, in place of the game's currently
stored title. This is the retry path when a first `enrich` came back with the
wrong candidates: the stored title ("Pacman", say, from a `start` command
typed as-is) may search poorly against a provider's own relevance, even
though it normalizes identically to the right answer. Re-invoking with
`gamereg enrich "Pac-Man"` sends the better string, and a confident match
corrects the stored title and files the old spelling as an alias — the
existing `game.enrich` title-replacement mechanism (01-model.md), not a new
one. Nothing renames the game just because a differently-spelled `<query>`
was given; only a successful match does that. Omitted `<query>` (the
`--all`/cron path) searches with each game's currently stored title,
unchanged.

When a provider search returns more than one plausible title match for a
single named game, this is ambiguity, not failure: exit 3 with
`candidates[]`, same shape as any other resolution ambiguity
(03-resolution.md). A human at a terminal gets the usual menu; a script or
agent re-invokes with `--match <provider>:<id>` to fetch that exact
candidate directly, skipping search. `--all` never prompts or exits 3 for
this — an ambiguous provider match during a bulk run is left as-is, same as
no match at all, so a cron enrich never blocks on a question nobody is
there to answer.

When title matching alone leaves more than one candidate, the platform
already recorded on this game's runs narrows it further, and resolves it
outright when exactly one candidate matches — a stronger signal than the
platform hint local resolution uses only as a filter (03-resolution.md).
Both sides of that comparison go through `canonicalPlatform()` (*Platform
vocabulary*), which is what lets a run recorded as `switch` match a catalog
entry that calls itself "Nintendo Switch". Runs with no platform recorded
contribute nothing to the narrowing and are skipped, not treated as a
mismatch.

**`enrich` reads run platforms; it never writes one.** A run left with
`platform: null` is filled by `end`, `finish` or `drop` — offline, from
whatever this command already stored on the game. The network command owns
`game.*` and the recording commands own `run.*`, and that line does not move
just because the two happen to talk about platforms.

**Never overwrites a cover with `source: user`.** `--covers --force` still
respects that; only `gamereg cover --reset` gives provider art back.

### `gamereg build [target...] [--force] [--list]`

Regenerates every derived artifact. Idempotent.

```
gamereg build                    # every target in build.targets
gamereg build csv                # one target, as a convenience while iterating
gamereg build obsidian csv       # a subset
gamereg build --list             # what this vault declares, and what it wrote
```

**The argument narrows a build; it never defines what the vault contains.** Which
targets exist is `build.targets` in `gamereg.config.json`, defaulting to
`["obsidian"]`. An unknown target exits 2 and lists the valid ones; a target from
a later phase exits 2 saying so.

`--force` rewrites every derived file whether it changed or not, and is the only
path that overwrites a seeded `.base`.

A target that fails does not stop the others: the build finishes, reports what
failed, and exits 1 having written everything that worked — the same principle as
code 6, where local work is committed even though the network step was not.

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

Both append. Neither touches the original line.

### `gamereg import <file.csv> --mapping <file.json>`

Bulk historical import, for people arriving from a spreadsheet. Emits one
`run.import` per row (plus one `run.verdict` for a row that maps `verdict`).
`--dry-run` is strongly recommended and documented as such — see the warnings
below on what an import gets wrong permanently if it isn't checked first.

```
gamereg import games.csv --mapping mapping.json [--dry-run]
```

**The mapping file** is a flat JSON object: gamereg field name → the CSV's own
column header for that field. A field absent from the mapping, or mapped to an
empty string, is simply not imported.

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
| `title` | yes | Free text — the query `resolveGame` matches or creates from, same as `past`'s argument. |
| `ended` | yes | `2011`, `2011-07` or `2011-07-14` — precision is inferred from the shape, same as `past --ended`. |
| `started` | no | Same shape rule as `ended`. Defaults to `ended` when omitted. |
| `hours` | no | A decimal number, e.g. `42.3`. **Decimal point only** — see below. |
| `rating` | no | An integer 0–11, or `none`. |
| `difficulty` | no | One of the vocabulary's difficulty tokens. |
| `criteria` | no | One of the vocabulary's completion-criteria tokens. |
| `outcome` | no | One of the vocabulary's outcome tokens. |
| `platform` | no | Free text, canonicalized against `config.platforms` like everywhere else. |
| `form` | no | One of the vocabulary's form tokens. |
| `mode` | no | One of the vocabulary's mode tokens. |
| `note` | no | Free text — what the run itself says. |
| `verdict` | no | Free text — the considered opinion, filed as a separate `run.verdict` event against the same run. |

Valid tokens for `difficulty`, `criteria`, `outcome`, `form` and `mode` are not
repeated here — they are the register's own vocabulary and drift the moment
they are copied. Ask `gamereg vocab --json` (see D9 — *Capability is
introspectable, never a list the caller keeps* — in
[00-architecture](00-architecture.md), and *Language* in `CLAUDE.md`).

**Number format is not negotiable.** `hours` accepts a plain decimal point —
`12.5`, not `12,5`. `1,500` is ambiguous between a thousands separator and a
comma decimal, and the log has to be readable in ten years regardless of which
locale exported the spreadsheet; a comma-decimal cell fails that one row with
"must be a positive number, not NaN" rather than being guessed at. Reformat the
column before importing, not after.

**Resolution is entirely offline**, same as `past`: no provider is reached
(non-negotiable 5), an unmatched title becomes a new local entry
(`allowCreate`, same as `past`'s `query`), and `--platform` is free text
canonicalized the same way. Run `gamereg enrich --all` afterwards to fetch
metadata and covers for whatever the import created.

**A row that fails does not stop the import.** Each row is resolved and
staged independently; a bad row is reported by its 1-indexed line number
(header is line 1) and everything that succeeded is still committed. The
command exits 0 only when every row succeeded, 1 when some failed (with
`result.failed[]` naming which), and 2 for a usage error that stops before any
row is processed — an unreadable file, or a mapping missing a required field.

```json
{ "ok": false, "code": 1, "error": "error",
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
  see `CLAUDE.md`'s note on measured vs. stated hours. `gamereg stats` will
  show gaps for years that were, in reality, entirely played. That is not a
  bug: those hours are stated (`hours_source: stated`), never measured, and
  the register never invents the days they happened on.

### `gamereg doctor`

Validates the log: unknown enums, sessions closing before they open, runs closed
twice, orphan references, breaks outside sessions, slug collisions. Reports; does
not fix. Exit 1 if anything is wrong.

## Command name mapping (pt-BR)

Shipped in `i18n/pt-BR.json`, illustrative:

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
| `init` | `inicializar` |
| `build` | `construir` |
| `query` | `consultar` |
| `amend` | `corrigir` |
| `vocab` | `vocabulario` |

Flags are localized the same way (`--rating` / `--nota`). Both spellings always
work regardless of locale — locale sets the *output* language, not the accepted
input.
