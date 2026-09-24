# 0106. A game's cover reaches the derived artifacts as three columns on `games`

- **Status:** Accepted
- **Date:** 2026-09-24
- **Area:** Build and targets

## Context

[0101](0101-attachments-are-resolved-to-their-owner.md) made photos reachable
from the derived artifacts. It did not cover covers, and could not: the cover
was reachable from no derived artifact at all. `games` had no cover column,
`data/export.json` and the CSVs mirror that absence, and the only
machine-readable copy in a built vault was a wikilink in a run note's
frontmatter — which couples a consumer to whichever of `obsidian` / `quartz`
happens to be enabled.

The instinct is that `attachments` already solves this. It does not, and cannot:
[01-model](../spec/01-model.md) makes them different assertions on purpose. An
attachment belongs to an event on the timeline, there are N of them, and one is
never mutated. A cover belongs to a game, there is exactly one, and it is
replaceable. Only `session.open`, `session.close`, `run.close`, `run.import` and
`attachment.add` carry `attachments[]`; `game.cover` and `game.enrich` do not, so
a cover never reaches `state.attachments` and never becomes a row.

Measured against the live vault — 19 games, all with a cover — **14 come from a
provider** (`game.enrich`, whose payload carries `cover` at the top level, not
inside `fields`), and none of those is an attachment in any sense: the bytes sit
in `assets/` with nothing pointing at them. The other **5 come from the user**,
promoted from a photo, and those hashes *are* attachment rows — but the table has
no "this one is the cover" flag, so finding the right one is an accident of there
being one, not a query. 14 of 19 invisible, 5 of 19 not identifiable.

## Decision

`games` gains `cover_sha256`, `cover_url` and `cover_source`, mirroring
`GameState.cover` in `src/core/fold.ts` field for field, and `csv` and `json`
follow as [07-targets](../spec/07-targets.md) requires. All three are nullable: a
game may have no cover; `cover_url` is null for a user promotion (5 of 5
measured); `cover_sha256` is null while a provider cover is a URL recorded but
never downloaded, which is reachable by construction because `game.enrich`
accepts `cover` as a bare URL string and the fold reads that shape forever.
`cover_source` is never null while either other column is set.

`cover_source` is carried rather than dropped. It is invariant 11 and
[0024](0024-user-covers-are-never-replaced.md) made visible at the derived
layer: a consumer can see *why* a cover is what it is, and an audit can spot a
user cover that enrichment should never have touched. Dropping it would leave the
derived layer unable to express the one rule the model cares most about here.

There is no `cover_path` column, consistent with 0101:
`assets/<sha256[0:2]>/<sha256>.webp` is 01-model's rule and belongs to it.

## Consequences

**A separate `images` table with `games.cover` as a foreign key was considered
and declined.** It is the obvious suggestion and will be raised again, so the
reasoning is here rather than rediscovered:

- **Content addressing already is the normalization.** `sha256` is a natural
  key; a surrogate `image_id` would be *less* normalized, not more. The hash
  determines the path, so `cover_sha256` already points at the image completely.
- **The table would carry nothing.** Measured: `ext` is always `webp`
  ([04-derived](../spec/04-derived.md) guarantees the WebP path), `captured_at`
  is null in 17 of 17 attachments, and `kind` and `caption` belong to the
  *assertion*, not to the bytes. That leaves a key that is already the value.
- **No duplication exists to eliminate.** 17 distinct attachment hashes, none
  appearing under more than one target.
- **`csv` and `json` flatten tables for spreadsheets and scripts.** A foreign
  key pushes a join onto exactly the consumers least able to pay it.

If the union question — "every image this vault knows about" — ever turns out to
matter, the answer is a **view**, not a table: `v_images` over `attachments`
UNION `games.cover_sha256`. The schema already uses views for the shape most
questions ask in, and a view costs `csv` and `json` nothing because they flatten
tables only. Do not build it speculatively.

**No change to `01-model.md`.** The event model already carries covers; this is
the derived layer catching up to it. "New columns" reads like a model change and
is not one.

Invariant 8 is what improves: the gap was forcing every consumer outside this
repository to read the raw log — or a note's frontmatter — to learn what a game's
cover is. `example-vault/` grew the three `game.enrich` shapes that prove it,
including the bare-URL one the live vault cannot teach, and the goldens moved
accordingly: a provider cover now reaches the obsidian and quartz targets in the
fixture for the first time.

## Related

- [src/db/schema.ts](../../src/db/schema.ts), [src/db/build.ts](../../src/db/build.ts)
- [src/targets/csv.ts](../../src/targets/csv.ts), [src/targets/json.ts](../../src/targets/json.ts)
- [src/core/fold.ts](../../src/core/fold.ts) — `Cover`, and the dual-shape reader
- [test/cover-columns.test.ts](../../test/cover-columns.test.ts)
- [docs/spec/04-derived.md](../spec/04-derived.md#sqlite), [docs/spec/07-targets.md](../spec/07-targets.md#the-targets)
- [agent/skills/gamereg/reference/query.md](../../agent/skills/gamereg/reference/query.md)
- [0101](0101-attachments-are-resolved-to-their-owner.md) — the same job for photos, and why it stopped short of this
- [0024](0024-user-covers-are-never-replaced.md) — the rule `cover_source` makes visible
- [0027](0027-fixture-webp-never-regenerated.md) — why the new fixtures reuse an existing hash
- [0058](0058-astro-gets-a-projection.md) — the nested projection this is still not
- [0068](0068-query-reference-mirrors-the-schema.md) — the test that held the reference to this schema
