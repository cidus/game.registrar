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
| 5 | conflict | State conflict (session already open, no session to close) |
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

## Recording commands

### `gamereg start <query>` — open a session

```
gamereg start "hollow knight" [--id igdb:7346] [--platform switch]
                              [--form digital] [--mode solo] [--replay]
                              [--at 20:14] [--no-metadata]
```

Behaviour:
1. Resolve `<query>` to a game (see 03).
2. If no open run exists for it, append `run.open`. If one exists, reuse it.
   `--replay` forces a new run even when a closed one exists.
3. Append `session.open`.

Conflict (code 5) if a session is already open for that run. If a session is open
for a *different* game, that is not an error — parallel runs are allowed and
common. The Registrar mentions it.

Metadata enrichment does **not** happen here. `run.open` writes only what is
known locally; `gamereg enrich` runs afterwards, possibly from cron. A start
command must never fail because IGDB is down.

**Platform, when `--platform` is omitted and none of the fallbacks answer.**
Resolution order is `--platform` → the game's last run → `config.defaults.platform`.
When none of those resolve it, a human at a terminal is offered a `select`
of `config.platforms` (see *Platform vocabulary* below) with a trailing
"Other" choice for free text — same interactive-fallback shape used
elsewhere (e.g. `gamereg init`'s prompts). A machine or a human under
`--json`/`--non-interactive` still gets `error.platform_required`, exit 2,
unchanged. Whatever is picked or typed becomes this run's platform; if it
was typed fresh (not already in `config.platforms`), it is also appended
there before the run is staged, so it is a suggestion next time instead of
a retyped guess. `gamereg past` never has this fallback — a missing platform
there is left `null`, not an error, per its own section below.

### `gamereg end [<query>]` — close a session

```
gamereg end [--at 23:52] [--break 40m] [--note "..."] [--photo path.jpg]
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

### `gamereg past <query>` — file a historical game

```
gamereg past "chrono trigger" --ended 2011-07 --rating 10
             [--started ...] [--hours 30] [--criteria credits] [--note "..."]
```

Emits `run.import`. Date precision is inferred from the shape of the argument:
`2011` → year, `2011-07` → month, `2011-07-14` → day.

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

### `gamereg open` — list open sessions

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
    "game": "Hollow Knight",
    "opened_at": "2026-08-12T20:14:00-03:00",
    "open_for_minutes": 412,
    "net_minutes": 372,
    "trigger": "duration",
    "threshold": "5h",
    "checkins_so_far": 1,
    "last_checkin_at": "2026-08-12T23:14:00-03:00"
  }
] } }
```

`trigger` is what the agent uses to choose its register — see
[05-agent](05-agent.md). Never hardcode the phrasing here; the CLI reports facts.

Backoff and thresholds are read from config; the CLI applies them, so every
caller behaves identically and cron needs no memory of its own.

### `gamereg checkin <session_id> --trigger <t> --outcome <o>`

Files a `session.checkin`. Called by the agent right after it asks, with
`--outcome snoozed`, then amended when the answer lands — or left to expire as
`no_reply`.

Without this call the session stays outside any backoff window and the next cron
run asks again. That is the intended failure mode: **forgetting to record a
check-in makes the assistant repeat itself, never go silent.**

### `gamereg status [<query>]`

Vault summary, or one game's state.

### `gamereg query <sql>`

Runs read-only SQL against `data/log.db`. Rejects anything that is not a single
`SELECT`. This is how question-answering works — the agent writes SQL, the
database does the arithmetic, and no number is ever hallucinated.

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
someone builds it. `platform` itself stays free text everywhere it already
is (`01-model.md` deliberately never lists it as a controlled vocabulary,
and `03-resolution.md`'s "the platform hint filters, it does not resolve"
is unaffected). This is a *suggestion* list, layered on top, that grows from
what the user actually types — never a validator that rejects anything.

`gamereg.config.json` gains `platforms: string[]`, default `[]`, alongside
the existing `defaults.platform`. It is vault **configuration**, not
event-sourced state: nothing that writes to it appends an event, the same
way `init` itself "never touches `data/events.jsonl`."

- `gamereg init --platforms switch,pc,...` seeds it non-interactively, comma
  separated like `--targets`. Interactively (no flag, human at a terminal):
  a loop of `checkbox()` (already the pattern `askTargets()` in `init.ts`
  uses) offering the platforms known so far plus a trailing "Other" choice;
  picking "Other" prompts `input()` for a new name, adds it to the working
  set (selected), and re-shows the checkbox so another "Other" can be added
  — repeatable with no new UI primitive, `@inquirer/prompts` (already a
  dependency) handles this fine as sequential calls, same as every other
  prompt in `init.ts`. Ends when the user submits without picking "Other"
  again.
- `gamereg platform add <name>` / `gamereg platform remove <name>` —
  subcommands, same shape as `gamereg break start|end`. Rewrite
  `gamereg.config.json` directly, like `init`; touch nothing else. `add` is
  idempotent — dedup by `normalize()`, but the original typed casing is what
  gets stored (same principle as `game.alias`: compare normalized, keep the
  literal text). `remove` is a no-op, not an error, when the name isn't
  present — it only edits a suggestion list, nothing it removes was ever
  load-bearing.
- `gamereg start`'s interactive platform fallback (see `start`'s section
  above) reuses the same "known list + Other" shape as a single-choice
  `select()` (a run has exactly one platform, unlike `init`'s set). A value
  typed via "Other" there is appended to `config.platforms` before the run
  is staged — the list grows from actual use, not just from `init`/`platform
  add`, so typos become progressively less likely without the user ever
  having to manage the list by hand.
- Needs pt-BR command-name/flag mapping in `i18n/pt-BR.json`'s tables (same
  place `break` → `intervalo` lives) — exact wording is an implementation
  detail, not specified here.

### `gamereg alias <query> --add <alias>`

## Provider credentials

Two sources, checked in this order, first one present per key wins:

1. **Environment variables** — `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`,
   `RAWG_API_KEY`, one variable per credential, named `<PROVIDER>_<FIELD>`.
2. **`gamereg.secrets.json`** at the vault root, seeded empty by `init` and
   gitignored by `init`. Same shape as `gamereg.config.json`, keyed by provider:

   ```jsonc
   { "igdb": { "client_id": "...", "client_secret": "..." }, "rawg": { "api_key": "..." } }
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

```json
{ "ok": false, "code": 1, "error": "target_failed",
  "result": { "written": ["Games.md"], "removed": [],
              "failed": [{ "target": "sqlite", "message": "..." }] } }
```

See [04-derived](04-derived.md) for the artifacts and
[07-targets](07-targets.md) for the target contract.

### `gamereg amend <event_id> --reason "..." [--set k=v ...]`
### `gamereg revoke <event_id> --reason "..."`

Both append. Neither touches the original line.

### `gamereg import <file.csv> --mapping <file.json>`

Bulk historical import, for people arriving from a spreadsheet. Emits one
`run.import` per row. `--dry-run` is strongly recommended and documented as such.

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
| `init` | `inicializar` |
| `build` | `construir` |
| `query` | `consultar` |
| `amend` | `corrigir` |

Flags are localized the same way (`--rating` / `--nota`). Both spellings always
work regardless of locale — locale sets the *output* language, not the accepted
input.
