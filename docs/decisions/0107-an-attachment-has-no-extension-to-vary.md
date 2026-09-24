# 0107. An attachment has no extension to vary, so the derived artifacts stop carrying one

- **Status:** Accepted
- **Date:** 2026-09-24
- **Area:** Build and targets

## Context

Two pieces of the code asserted opposite things about one fact, and both shipped.

`render/assets.ts`'s `assetPath()` hardcodes `.webp` and is shared by the game
note, the run note and the consolidated table — so every embed, link and
thumbnail in a built vault assumes an attachment's file cannot be anything else.
Meanwhile `ext` was recorded on every `attachments[]` payload entry, folded into
`Attachment`, typed `string`, and emitted as a `NOT NULL` column through
`sqlite`, `csv` and `json` — so the derived artifacts presented it as a per-row
fact a consumer might read, or build a path out of.

One of those had to be wrong, and the fixtures could not say which: every
attachment in `example-vault/` is `webp`, as are all 17 in the live vault. The
pipeline can, and does:

- `images/ingest.ts` encodes WebP, then hashes **the normalized bytes** and
  writes `assets/<sha[0:2]>/<sha>.webp`. The hash is therefore the hash of a
  WebP file by construction. A hash and a `.webp` are one fact, not two.
- `IngestResult.ext` is the literal type `'webp'`, and every call site returns
  exactly that. There has never been a code path that produced another value.
- `images.keep_original` — the one setting that puts a differently-suffixed file
  in `assets/` — writes `<sha256>.original.<source format>`: a **sibling**, named
  off the same WebP hash, that no attachment and no derived row ever references.

[01-model](../spec/01-model.md) already said as much, in the sentence the code
was not honouring: "Ingestion sets an attachment's `ext` to `webp`, describing
the stored bytes rather than naming a second location."

So `assetPath()` was right, and the column was the error. Not a harmless one:
`fold.ts` read `ext` straight off the payload (`str(entry, 'ext') ?? 'webp'`), so
a hand-written or amended event claiming `"ext": "png"` would travel all the way
into a queryable column and describe a file that does not exist.

## Decision

The extension is not data. `ext` is removed from `AttachmentRow` and from the
`attachments` table in all three targets, and `Attachment.ext` is narrowed from
`string` to the literal `'webp'` with the fold no longer reading the payload's
value — the field holds the format, never the claim.

`assets/<sha256[0:2]>/<sha256>.webp` stays [01-model](../spec/01-model.md)'s
rule, which is now the only place it is stated.

**The event payload is unchanged.** `attachments[]` entries still carry
`ext: "webp"`; 01-model specifies that field, the log is append-only so every
event written so far has it, and removing it would be a model change rather than
a derived-layer one. Whether new events should still record a constant is a fair
question and is left open below, for the maintainer rather than for a session.

## Consequences

`log.db` loses a column, which costs nothing to consumers of the cache
(invariant 10) but is a real change to `data/attachments.csv` and
`data/export.json`, and it moved the `example-vault/` goldens.

What replaces it is a rule rather than a field: given a hash, the file is
`assets/<first two characters>/<hash>.webp`. That is one lookup in 01-model
instead of a column whose only correct use was to be ignored.

`test/ingest.test.ts` is where the decision is pinned, deliberately at the
pipeline and not at a fixture: a PNG and a JPEG both come out as the `.webp`
`assetPath()` names, and `keep_original` is checked to add its sibling without
moving where the attachment lives. Reintroducing a source extension anywhere in
ingestion fails those. `test/attachment-rows.test.ts` covers the other half —
no `ext` in the rows, the CSV header, the JSON payload or the SQLite table, and
a payload claiming `png` folding to `webp` regardless.

**If an attachment ever legitimately is not a WebP** — an animated format, a
video, a PDF scan of a manual — this is the record to reopen, and the change is
larger than restoring a column: `assetPath()`, the embeds that use it, the
ingestion pipeline's single `.webp()` encode and 01-model's content-addressing
rule all move together. A column that varies while `assetPath()` does not is the
state this record exists to forbid.

## Related

- [src/images/ingest.ts](../../src/images/ingest.ts) — the pipeline the answer came from
- [src/render/assets.ts](../../src/render/assets.ts) — `assetPath()`, now correct by argument rather than by luck
- [src/core/fold.ts](../../src/core/fold.ts), [src/core/attachments.ts](../../src/core/attachments.ts)
- [src/db/schema.ts](../../src/db/schema.ts), [src/db/build.ts](../../src/db/build.ts), [src/targets/csv.ts](../../src/targets/csv.ts)
- [test/ingest.test.ts](../../test/ingest.test.ts), [test/attachment-rows.test.ts](../../test/attachment-rows.test.ts)
- [docs/spec/04-derived.md](../spec/04-derived.md#sqlite), [docs/spec/01-model.md](../spec/01-model.md) (*Content addressing*, unchanged)
- [agent/skills/gamereg/reference/query.md](../../agent/skills/gamereg/reference/query.md)
- [0101](0101-attachments-are-resolved-to-their-owner.md) — added the column, and named this contradiction as a reason there is no `path` column
- [0106](0106-the-cover-is-three-columns-on-games.md) — declined an `images` table partly because `ext` carried nothing
- [0027](0027-fixture-webp-never-regenerated.md) — why no fixture could have answered this
