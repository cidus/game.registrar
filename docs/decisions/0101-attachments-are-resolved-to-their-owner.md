# 0101. Attachments reach the derived artifacts resolved to their owner

- **Status:** Accepted
- **Date:** 2026-09-19
- **Area:** Build and targets

## Context

A photo filed against a session, a run or a game was reachable from no derived
artifact in a machine-readable form. The SQLite tables carried no attachment
column, `csv` and `json` mirror those tables, the run note's session table drops
photos entirely, and the game note's gallery groups them per game with no run or
session identity. The only route to "which photos belong to this session" was
the raw `events` table — which means reimplementing `event.revoke` and
`event.amend`, and the live vault has 31 revokes and 29 amends to get wrong.
Invariant 8 holds inside this repository, and the artifacts were forcing every
consumer outside it to do what no target is allowed to do.

The instinct on reading "attachments are not queryable" is that the *correction*
handling has to be built. It did not: the fold has always applied every revoke
and amend before an attachment reached `state.attachments`, and that is where it
stays. What was missing is the **key**. That map is keyed by *target* — an event
id, or a game id — which is what the log carries and not what anybody asks in.

## Decision

`src/core/attachments.ts` resolves the fold's target key to
`(game_id, run_id, session_id)`, and `sqlite`, `csv` and `json` all call it,
since [04-derived](../spec/04-derived.md) says the three may not disagree about
what a column means. The table is `attachments(sha256, ext, kind, caption,
captured_at, filed_at, game_id, run_id, session_id, target)`; `game_id` is
always known, the narrower two are null for a photo filed against the game
itself, and `target` is kept for the same reason `runs.platform_raw` is — the
resolved view, plus the way back to the log.

The walk lives in `core/` rather than in `db/build.ts` because three targets
emit these columns, and because the gallery already asks the same question.

`filed_at` comes from `filedAtOf`, exported from `fold.ts` and used by the game
note's gallery too, so the two dates cannot drift. There is **no `path`
column**: `assets/<sha256[0:2]>/<sha256>.<ext>` is
[01-model](../spec/01-model.md)'s rule, and `render/assets.ts` already assumes
WebP regardless of the recorded `ext`, so a copy would have to pick one of those
two answers.

## Consequences

One row per `(target, sha256)`, so a photo attached to a session and then
promoted to the game's cover is two rows about one picture; a consumer building
a gallery de-duplicates on `sha256`, as the game note already does.

Two traps found on the way, both worth knowing before touching this walk. A
`session.open` event's own id is **not** the session id — both are ULIDs minted
in the same command, so they share a long prefix and keying by the wrong one
matches nothing while looking plausible. And the fold keys an `attachment.add`'s
payload under its own event id *as well as* under its target, so resolving the
self-key too would double every retroactive photo; it resolves to no entity and
is dropped, which is exactly what the gallery already does with it.

The general rule both follow: derived duplication is free when it regenerates
from one function, and a liability the moment it regenerates from two.

## Related

- [src/core/attachments.ts](../../src/core/attachments.ts)
- [src/core/fold.ts](../../src/core/fold.ts)
- [src/db/build.ts](../../src/db/build.ts), [src/targets/csv.ts](../../src/targets/csv.ts), [src/targets/json.ts](../../src/targets/json.ts)
- [test/attachment-rows.test.ts](../../test/attachment-rows.test.ts)
- [docs/spec/04-derived.md](../spec/04-derived.md#sqlite), [docs/spec/07-targets.md](../spec/07-targets.md#the-targets)
- [agent/skills/gamereg/reference/query.md](../../agent/skills/gamereg/reference/query.md)
- [0058](0058-astro-gets-a-projection.md) — the projection that must *not* be this table
- [0068](0068-query-reference-mirrors-the-schema.md) — the test that holds the reference to this schema