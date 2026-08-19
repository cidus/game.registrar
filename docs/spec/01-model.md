# 01 — Data Model

## Entities

| Entity | Identity | Meaning |
|---|---|---|
| `game` | `game_id` (ULID) | A title. Catalog entry, one Markdown note in `games/`. |
| `run` | `run_id` (ULID) | One playthrough of a game, start to end. One generated note in `runs/`. |
| `session` | `session_id` (ULID) | One sitting inside a run. |
| `break` | `break_id` (ULID) | A pause inside a session. |
| `person` | `person_id` (ULID) | A player. Reserved for phase 4 (board games). |

A game has N runs. A run has N sessions. A session has N breaks.

`slug` is the filename (`games/hollow-knight.md`) and is **mutable**. `game_id`
is identity and is **immutable**. Never key anything on the slug. Run notes are
named from the slug and the start date, so they move when either does — that is a
build concern, handled by ownership rather than by identity
(see [07-targets](07-targets.md)).

## Event envelope

`data/events.jsonl`, one JSON object per line, no wrapping array, LF endings.

```json
{
  "id": "01K2X8F3QJ7Y0M9V4R6NBTZHW2",
  "ts": "2026-08-12T20:14:03-03:00",
  "type": "session.open",
  "source": "cli",
  "schema": 1,
  "data": { "session_id": "01K2X8F3QK...", "run_id": "01K2W...", "at": "2026-08-12T20:14:00-03:00" }
}
```

| Field | Rule |
|---|---|
| `id` | ULID. Lexicographically sortable by creation time. |
| `ts` | When the event was **recorded**. Always ISO 8601 with offset. |
| `type` | Dotted, `entity.verb`. Closed set — see below. |
| `source` | `cli` \| `chat` \| `cron` \| `import` |
| `schema` | Integer. Bump only on breaking change; migrations are append-only. |
| `data` | Payload. Semantic times live here, never in `ts`. |

**`ts` vs `data.at` matters.** Filing a session on Tuesday that happened on Sunday
gives `ts` = Tuesday and `data.at` = Sunday. Every report reads `data.at`. `ts`
exists for auditing and for ordering the fold.

## Ordering

Events are folded in **file order**, which for appended ULIDs is chronological by
recording time. Do not sort by `data.at` — a retroactive correction must apply
after the event it corrects, even though it describes an earlier moment.

## Event types

### Catalog

| Type | Payload |
|---|---|
| `game.create` | `game_id`, `slug`, `title`, `sort_title?`, `release_year?`, `genres[]`, `developer?`, `publisher?`, `platforms[]`, `providers{}`, `aliases[]` |
| `game.alias` | `game_id`, `alias` — every manual disambiguation emits one |
| `game.rename` | `game_id`, `slug`, `title?` — old note is deleted by build, not orphaned |
| `game.enrich` | `game_id`, `provider`, `fields{}` (may include `title`), `cover?` — replaces that provider's fields wholesale |

`providers` maps provider name to external id: `{"igdb": 7346, "steam": 367520}`.
Empty is legal — a game with no provider is a first-class game.

**A provider-corrected title replaces the stored one, same as every other
enriched field.** Unlike `game.rename` — where the old title is simply
overwritten, since a human chose to type it — `game.enrich` changing the
title also files the title it replaces as an alias, normalized, so the name
the user already searches by keeps resolving. No alias is added when the two
titles are already the same once normalized, or when the game has no
readable title yet.

### Runs

| Type | Payload |
|---|---|
| `run.open` | `run_id`, `game_id`, `platform?`, `form`, `mode`, `started_on`, `date_precision?`, `replay`, `hours?` |
| `run.close` | `run_id`, `ended_on`, `outcome`, `completion_criteria`, `rating?`, `difficulty?`, `note?` |
| `run.import` | Historical entry: everything above in one event, plus `hours?` and `date_precision` |
| `run.verdict` | `run_id`, `text` — the consolidated review of that playthrough |

`run.import` exists because past games have no sessions. It produces a closed run
whose hours are stated, not computed. Reports must never treat a stated total as
if it were measured — see `hours_source` in derived state.

**`platform` is optional.** `start` records what it knows and nothing more, so a
run may exist — and may close — with the platform still unknown. It is filled in
later by an `event.amend` over the `run.open` event, never by a second `run.open`.
See 02-cli.md, *Platform, when a run closes*. It remains free text: the vocabulary
in 02-cli.md canonicalizes spellings and orders what gets offered, and rejects
nothing.

**`hours` is an optional stated baseline** on `run.open` itself — playtime that
happened before this vault started tracking the run (`gamereg start
--past-hours`, or `gamereg past` filed without `--ended`, see 02-cli.md). It
folds into `run.minutes` alongside whatever sessions open later on the same
run; see *Duration* below for the arithmetic. Ordinary `start`, typed without
the flag, never sets it — the field exists for the one case where someone
already has playtime the register never saw. `date_precision` follows the
same shape-of-the-argument rule as `run.import`'s, and is used only when
`started_on` itself is a guess (typically `year`) rather than the exact day
`start` would otherwise stamp.

`run.verdict` carries prose and nothing else. It is separate from `run.close`
because the verdict is usually written later — the run ends when you stop
playing, the words arrive when they arrive — and because a verdict may be
rewritten without reopening the question of when the run ended. Filing a second
verdict for the same run replaces the first in the fold; both stay in the file.

**Who wrote it is not modelled.** A verdict typed into a terminal and one drafted
by an agent are the same event. The envelope's `source` already records which
channel filed it, and that is as far as the model goes: whether prose is composed
by a person, by a language model, or by a person editing what a model drafted is
a question for the layer above (see [05-agent](05-agent.md)). The register stores
the text.

### Sessions

| Type | Payload |
|---|---|
| `session.open` | `session_id`, `run_id`, `at` |
| `session.close` | `session_id`, `at`, `break_minutes?`, `note?` |
| `break.open` | `break_id`, `session_id`, `at` |
| `break.close` | `break_id`, `at` |
| `session.checkin` | `session_id`, `at`, `trigger`, `outcome` |

`session.checkin` records that the Registrar asked after an open session and what
came of it. It exists for two reasons: it is the **backoff state** that stops a
recurring cron from asking every time it runs, and it is genuinely interesting
data later ("how often do I play past the point where I meant to stop").

- `trigger`: `duration` \| `clock` \| `day_cutoff`
- `outcome`: `snoozed` \| `break_started` \| `session_closed` \| `no_reply`

`outcome` is filed when the answer arrives, or as `no_reply` when the backoff
window expires with silence. A check-in never mutates the session by itself; if
the user says they are stopping, that is a separate `session.close` event.

### Attachments

Photos and screenshots. Two distinct roles, deliberately not the same thing:

| | Attachment | Cover |
|---|---|---|
| Belongs to | An event, on the timeline | A game |
| How many | N | Exactly one |
| Mutable | Never | Replaceable |
| Meaning | "this happened" | "this is the game" |

Any event may carry `attachments[]` in its payload:

```json
"attachments": [
  { "sha256": "e3b0c442...", "ext": "webp", "caption": "Watcher Knights, finally",
    "captured_at": "2026-08-12T22:40:11-03:00", "kind": "screenshot" }
]
```

`kind`: `screenshot` \| `photo` \| `box` \| `media` \| `other`. Advisory only —
it drives presentation, never logic.

| Type | Payload |
|---|---|
| `attachment.add` | `target` (event id, or `game_id`), `attachments[]` |
| `game.cover` | `game_id`, `sha256` \| `url`, `source` |

`attachment.add` exists for the retroactive case ("forgot to send the photo").
Inline `attachments[]` on the original event is the normal path; both fold into
the same list.

**Content addressing.** Files live at `assets/<sha256[0:2]>/<sha256>.<ext>` and
are referenced by hash, never by filename. This makes ingestion idempotent,
deduplicates the same screenshot attached twice, and removes any possibility of
filename collision across years.

**Cover precedence.** `game.cover.source` is `user` or `provider`.
**`game.enrich` must never overwrite a cover whose source is `user`.** Without
this rule, setting your own box photo and then letting `enrich` run from cron
silently reverts it — the exact failure that makes people stop trusting the tool.

Promotion is how a photo becomes a cover: any attachment already in the log can
be pointed at by `game.cover` using its hash. The attachment stays on the
timeline; the cover is a separate assertion about the same bytes.

### Corrections

| Type | Payload |
|---|---|
| `event.amend` | `target` (event id), `reason`, `patch{}` — shallow merge over target's `data` |
| `event.revoke` | `target`, `reason` — target is ignored by the fold, stays in the file |

There is no delete. Ever.

### Reserved — phase 4, board games

| Type | Payload |
|---|---|
| `person.create` | `person_id`, `name`, `aliases[]` |
| `play.record` | `play_id`, `game_id`, `at`, `duration_min`, `players[]`, `note?` |

`players[]` is `{person_id, score?, rank?, winner: boolean, faction?}`.
A board game play is a session with no run around it — the model already allows
this because runs are optional for `play.record`.

## Controlled vocabularies

Stored values are the English tokens below. Display labels come from
`i18n/<locale>.json`. Unknown tokens are a validation error, not a warning.

### `outcome`
`finished` · `abandoned`

### `completion_criteria`
| Token | Meaning |
|---|---|
| `credits` | Credits rolled |
| `true_ending` | The real ending, beyond the default one |
| `full_completion` | 100% — everything the game tracks |
| `platinum` | All achievements/trophies |
| `enough` | No formal ending, or I stopped at a point I consider done |
| `endless` | Game has no ending by design (roguelike, sim, live service) |
| `abandoned` | Dropped before any of the above |

### `difficulty`
`trivial` · `easy` · `normal` · `hard` · `brutal`

Subjective — how hard it was *for me*, not the difficulty setting. The setting,
if relevant, goes in the session note.

### `form`
`physical` · `digital` · `emulator` · `subscription` · `borrowed` · `cloud` · `demo`

### `mode`
`solo` · `coop` · `versus` · `mixed`

### `rating`
Integer 0–10, or `null`. `null` is legal and common for abandoned runs — refusing
to rate is data.

`11` is accepted and documented. It means the game exceeded the scale. Reports
must not clamp it; charts must handle a max of 11.

### `date_precision`
`day` · `month` · `year`

Applies to `started_on` / `ended_on` on imported runs. `"2011"` with precision
`year` is honest; `"2011-01-01"` is a lie that will pollute every chart.

## Derived state

Built by folding the log. Never persisted as the source of truth — `data/log.db`
is a cache and is gitignored.

```ts
type GameState = {
  game_id: string
  slug: string
  title: string
  aliases: string[]          // normalized, for lookup
  providers: Record<string, string | number>
  runs: RunState[]
  total_minutes: number      // sum across runs
  status: 'unplayed' | 'playing' | 'finished' | 'abandoned'
}

type RunState = {
  run_id: string
  started_on: string
  ended_on: string | null
  outcome: 'finished' | 'abandoned' | null
  completion_criteria: string | null
  rating: number | null
  difficulty: string | null
  verdict: string | null       // latest run.verdict, if any
  sessions: SessionState[]
  minutes: number
  hours_source: 'measured' | 'stated' | 'mixed'
  open: boolean
}
```

`hours_source` is derived, not stored: `'stated'` when every minute on the run
comes from a declared baseline and no session has ever closed on it,
`'measured'` when there is no baseline and every minute comes from sessions,
`'mixed'` when both are present. It is recomputed on every fold, the same as
`minutes` — never read from the log.

### Duration

```
session.minutes = (close.at - open.at) - Σ(closed breaks) - close.break_minutes
```

Both break mechanisms are additive. A break left open when the session closes is
closed at the same instant.

Rules:
- Negative duration is a validation error. Reject the close, do not clamp.
- A session with no close is `open` and contributes **zero** minutes. It must not
  be silently estimated.
- `run.minutes` = the run's stated baseline (`run.open.hours`, or `run.import`'s
  `hours` — the same field, same unit, same honesty rule) **plus** Σ sessions.
  A run with no baseline behaves exactly as before: `run.minutes` = Σ sessions.
  A `run.import` filed with `--ended` never gains sessions (it is closed on
  arrival), so its stated total stays exactly as declared. A run opened with a
  baseline and no `--ended` — `start --past-hours`, or `past` without
  `--ended` — is `open`, and every session that closes on it afterwards adds
  to a number that started non-zero. Reports must never treat a stated portion
  as if it were measured; that is what `hours_source` is for.

### Logical day

A session starting at 22:00 and ending at 02:30 belongs to the day it **started**.
`day_cutoff` in config (default `05:00`) defines when a day flips for reporting.
Playing at 03:00 counts toward the previous day, which is what a person means.

**`logical_day` is derived, never stored.** No event carries one: it is computed
on every fold from the instant and `day_cutoff`, which is why raising the cutoff
re-groups history with nothing rewritten. The instant it is computed from
depends on `config.timezone`, and the two settings are two different — both
coherent — answers to what a day means:

| `config.timezone` | The instant used | What a day means |
|---|---|---|
| unset (`null`, what `init` writes) | as recorded, with its own offset | the local day where you were |
| a zone | projected into that zone | the day at home, wherever you played |

Both are stable under travel, and neither needs anything done about it. With no
zone configured, a session played at 08:00 in Tokyo was recorded `+09:00` and
stays on the Tokyo day; the machine's clock moving only affects events recorded
after it moved. With a zone configured, the machine's clock is ignored outright
— `gamereg` stamps new events in the configured zone and projects old ones into
it — so a Tokyo morning lands on the previous day at home, consistently, for as
long as that setting holds.

**Changing `config.timezone` is what actually rewrites the past.** Every
instant is re-projected, so a session can move a day in either direction across
the whole log at once, silently, on the next build. That is the one thing to be
deliberate about here; travelling is not.

There is no per-invocation timezone override, and deliberately so. The register
would then group by which machine happened to file an event — a phone abroad
against the always-on host at home — which is a worse answer than either row of
that table.

### Status derivation

- any open run → `playing`
- else last closed run's `outcome`
- no runs → `unplayed`
