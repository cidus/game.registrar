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

### `gamereg alias <query> --add <alias>`
### `gamereg enrich [<query>] [--provider igdb] [--all] [--covers]`

Network step, isolated. Appends `game.enrich` and fetches provider cover art.
Safe to run from cron. Failure here never blocks recording.

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
| `build` | `construir` |
| `query` | `consultar` |
| `amend` | `corrigir` |

Flags are localized the same way (`--rating` / `--nota`). Both spellings always
work regardless of locale — locale sets the *output* language, not the accepted
input.
