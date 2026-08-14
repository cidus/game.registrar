# gamereg — the surface you may invoke

Condensed from `docs/spec/02-cli.md`, which stays the source of truth. Every
invocation below is checked against the real binary by
`test/agent-skill.test.ts`, so a flag named here exists.

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

### `gamereg end`

```text
gamereg end --id --break --note --platform --photo --caption --kind --as-cover
```

Closes the open session. `--break <40m|1h20|90>` deducts time. This is where the
platform question belongs, and only when the result says `"platform": null`.

### `gamereg break start` / `gamereg break end`

```text
gamereg break start
gamereg break end
```

A pause inside the open session.

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

The vault summary, or one game's state. `<query>` is optional.

### `gamereg open`

```text
gamereg open
```

Every open session.

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

### `gamereg query`

```text
gamereg query <sql> --schema
```

Read-only SQL over the cache. `--schema` reports the tables, views and columns
instead of running a statement. See `query.md`.

### `gamereg platform list`

```text
gamereg platform list
```

What this vault suggests, in the order the CLI's own menu uses. This plus a
game's `platforms` is what you build a platform question from.

## Correcting — explicit instruction only

```text
gamereg amend <event> --set --reason
gamereg revoke <event> --reason
```

`--set key=value`, repeatable. Both name an event id. **Never invoke either
unless the user asked to correct something specific.**

## Metadata

```text
gamereg enrich <query> --id --provider --match --all --covers
```

The only command that touches the network. On exit 3, `candidates[]` are
provider entries and the retry is `--match <ref>`. `--all` never prompts.
Failure here never blocks recording.

```text
gamereg alias <query> --add --id
```

Teaches another name for a game — the correction path for a title that voice
transcription mangles the same way every time.
