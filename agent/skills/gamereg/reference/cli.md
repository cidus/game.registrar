# gamereg — the surface you may invoke

**Every invocation below is checked against the real binary by a test, so a
flag named here exists.** Trust it and stop; there is nothing to verify with
`--help`, which you cannot run anyway.

Always pass `--json`.

## The envelope

Success:

```json
{ "ok": true, "action": "session.open", "result": { }, "events": ["01K…"] }
```

Failure — on stdout, same as success:

```json
{ "ok": false, "code": 3, "error": "ambiguous", "message": "…", "candidates": [] }
```

`ok` is always present. **Branch on `code`, never on `message`** — messages are
localized and change.

## Exit codes

| Code | Name | What it means for you |
|---|---|---|
| 0 | ok | Done. |
| 1 | error | Unexpected. Report it; do not retry. |
| 2 | usage | You built a bad invocation. Read the message and fix it. |
| 3 | ambiguous | `candidates[]` is populated. Render buttons, re-invoke with `--id`. |
| 4 | not_found | Nothing matched. Ask, or use `--no-metadata` to open a new entry. |
| 5 | conflict | A session is already open, or there is none to close. |
| 6 | provider_unavailable | The network failed. **The local work was still committed.** |
| 7 | needs_confirmation | Destructive. Ask the user, then re-run with `--yes`. |

**A non-zero exit is shown to the user.** This gateway prints a failed-exec
warning naming the command for any exit but 0, so codes 3 and 4 — ordinary
control flow for you — read as breakage on their screen. Prefer the call that
returns 0: `search` never exits non-zero, while `start` on a game not yet on
record always exits 4.

## A candidate

```json
{ "ref": "igdb:7346", "title": "Hollow Knight", "year": 2017,
  "platforms": ["Nintendo Switch"], "source": "provider", "in_log": false }
```

`ref` is opaque and round-trips: it goes back in as `--id` (any command) or
`--match` (`enrich`). Never edit or construct one.

## Global flags

Accepted by every command, before or after the verb.

```text
gamereg --json --non-interactive --yes --vault --locale --dry-run --at --quiet
```

`--at` takes full ISO, `"2026-08-12 20:14"`, `20:14`, or `-90m` / `-2h`
relative to now. Ambiguity resolves toward the past.

## Recording

### `gamereg start`

```text
gamereg start <query> --id --platform --form --mode --replay --past-hours --no-metadata --photo --caption --kind --as-cover
```

Opens a run if none is open, then opens a session. Do not ask for a platform
here.

If a session on another game is still open, the result carries `also_open`
(`session_id`, `title`, `started_at`, …). `start` never closes it — that is
yours to offer.

`--form` is `physical | digital | emulator | subscription | borrowed | cloud |
demo`, and it is settled here or by `amend` — `end`, `finish` and `drop` do not
take it. `--kind` classifies the photos in this invocation; `--as-cover` makes
the first one the game's cover, `source: user`.

**`--past-hours <n>`** stamps a stated baseline onto the `run.open` this
invocation creates — playtime from before this vault tracked it ("already had
30h on it"). Only valid when this call actually opens a new run: reusing an
already-open run with `--past-hours` is a usage error (code 2), and there is
no way to add it after the fact through `start` or `past`. For a run already
in progress, use `amend` directly on that run's `run.open` event —
`gamereg amend <event_id> --set hours=<n> --reason "..."` — `hours` is the
same field name `--past-hours` writes, just via `amend` instead of at open
time. The event id is `run_open_event_id`, on the run's row from
`gamereg open` or `gamereg status <game>`. No SQL.

### `gamereg end`

```text
gamereg end --id --break --note --platform --photo --caption --kind --as-cover
```

Closes the open session. `--break <40m|1h20|90>` deducts time. This is where the
platform question belongs, and only when the result says `"platform": null`.

`--platform` here both fills a run that has none and corrects one already
recorded, in this one command — no `amend`, no confirmation. It is where a
platform mentioned earlier in the conversation gets filed.

### `gamereg break start` / `gamereg break end`

```text
gamereg break start <query> --id
gamereg break end <query> --id
```

A pause inside the open session. Both take a target the same way `end` does: a
title, or `--id game:<game_id>` for the exact one. **`--id` here names the game,
not the session** — a game has at most one open session, which is what makes
that unambiguous.

With one session open, no target is needed. With several and none given, both
exit 3 and list them rather than picking; if you already know which session you
mean, say so and skip the question.

### `gamereg finish`

```text
gamereg finish <query> --id --rating --difficulty --criteria --note --platform --photo --caption --kind --as-cover
```

Closes the run as finished, closing the session first if one is open.
`--rating` is 0–11 (11 means it exceeded the scale). `--difficulty` is
`trivial|easy|normal|hard|brutal`. `--criteria` is
`credits|true_ending|full_completion|platinum|enough|endless|abandoned`.

### `gamereg drop`

```text
gamereg drop <query> --id --rating --difficulty --criteria --reason --platform --photo --caption --kind --as-cover
```

Abandons the run. Same shape as `finish`.

### `gamereg past`

```text
gamereg past <query> --ended --started --hours --id --rating --difficulty --criteria --outcome --platform --form --mode --note --no-metadata --photo --caption --kind --as-cover
```

A run that started before this register existed. **With `--ended`**: a closed
run with stated hours; dates are `2011`, `2011-07` or `2011-07-14` and the
precision is taken from the shape. **Without `--ended`**: an open run carrying
`--hours` as a baseline, and no session. Requires one or the other.

### `gamereg verdict`

```text
gamereg verdict <query> --message --text --run --id
```

The consolidated review. `--text <file>`, or `--text -` for stdin. `--run`
names a playthrough; omitted, it targets the most recently ended.

## Photos

```text
gamereg attach <target> --photo --caption --kind
gamereg cover <query> --id --photo --kind --from --reset
```

`--photo` and `--caption` are repeatable on every recording command, and a
caption applies to the `--photo` immediately before it. `--kind` is
`screenshot|photo|box|media|other` and applies to every photo in that
invocation. `attach`'s target is an event id, or a game query.

`cover` takes exactly one of `--photo` (ingest and promote), `--from <hash>`
(promote something already on this game's timeline) or `--reset` (give provider
art back).

## Reading

### `gamereg status`

```text
gamereg status <query> --id
```

The vault summary, or one game's state. `<query>` is optional. Each run carries
`run_open_event_id` — the event an `amend` on that run's platform or stated
hours takes. This is the route for a run with no open session, which `open`
does not list.

### `gamereg open`

```text
gamereg open
```

Every open session. Each row carries `session_id`, `run_id`, `game`, `game_id`,
`opened_at`, `open_for_minutes`, `net_minutes`, `on_break`, `break_started_at`,
`checkins_so_far`, `last_checkin_id`, `run_open_event_id` and
`session_open_event_id`.

`last_checkin_id` is the check-in you amend when someone answers one. It is
`null` until a session has been asked about, and it is only readable while the
session is open.

**`run_open_event_id` and `session_open_event_id` are the ids `amend` and
`revoke` take.** Read them from here; never go looking for an event id with
SQL. The ids beside them — `run_id`, `session_id` — are entity ids and are not
accepted by either command.

### `gamereg search`

```text
gamereg search <term> --platform --provider --local-only
```

Never writes. Returns candidates in the same shape as exit code 3. This is what
you call to look something up without recording anything.

It is the one non-recording command that may reach a provider. `--local-only`
keeps it to the log; `--provider <name>` narrows the chain, and today `igdb` is
the only name that exists — a misspelling is a usage error, not a quiet fall
back to local results.

Pass `--platform` whenever the user named a console. It narrows the catalog
search itself, not just the list you get back, so it is the difference between
a family name returning the two entries that happened to survive and returning
the shelf. It still never resolves anything on its own: several candidates is
the same question code 3 asks.

### `gamereg query`

```text
gamereg query <sql> --schema
```

Read-only SQL over the cache. `--schema` reports the tables, views and columns
instead of running a statement. See `query.md`.

**The provider is consulted only when nothing local matches.** A vault that
already holds a similar title answers from itself and never asks the catalog, so
a record created under a guessed name quietly becomes the answer to every later
search. `--local-only` forces the local half; there is no flag that forces the
catalog half.

### `gamereg platform list`

```text
gamereg platform list
```

What this vault suggests, in the order the CLI's own menu uses. This plus a
game's `platforms` is what you build a platform question from.

### `gamereg vocab`

```text
gamereg vocab --locale pt-BR
```

The register's words in one language: outcomes, statuses, completion criteria,
difficulties, forms, modes, and the register's own acts (filed, approved,
archived, pending clarification, certified copy). Words only — no sentences, so
there is nothing here to reproduce as if the CLI had said it. Call it once when
you narrate in a language other than English, and use what it returns instead of
translating a token yourself. Needs no vault.

## Correcting — explicit instruction only

```text
gamereg amend <event> --set --reason
gamereg revoke <event> --reason
```

`--set key=value`, repeatable. Both name an event id. `--reason` is **required
on both** — they exit 2 without it. **Never invoke either unless the user asked
to correct something specific.**

## Metadata

```text
gamereg enrich <query> --id --provider --match --all --missing --covers
```

The only command that touches the network. On exit 3, `candidates[]` are
provider entries and the retry is `--match <ref>`. `--all`/`--missing` never
prompt. `--missing` is the unattended-cron selector — every game never
actually enriched for `--provider`, including one `start --id <ref>` created
from a bare provider reference — not something to reach for mid-conversation.
Failure here never blocks recording.

```text
gamereg alias <query> --add --id
```

Teaches another name for a game — the correction path for a title that voice
transcription mangles the same way every time.
