# 0091. Release pages carry the changelog section; annotated tags carry the narrative

- **Status:** Accepted
- **Date:** 2026-09-05
- **Area:** Versioning and releases

## Context

Two texts describe a release. `CHANGELOG.md` carries terse Added/Changed/Fixed lines, which is what someone upgrading wants. The annotated tag carries the narrative: why the work happened and what it proved. Publishing with `--notes-from-tag` puts the narrative on the release page, where every other release shows the changelog section — which is what happened on `v0.3.0` and had to be rewritten by hand afterwards.

## Decision

A GitHub release body is that version's `CHANGELOG.md` section, body only. The annotated tag keeps the narrative. `gh release create --notes-file`, never `--notes-from-tag`.

## Consequences

The changelog entry is the text strangers read, so it is written for them rather than for the maintainer.

Releases are backfilled oldest first, because GitHub marks the most recently created release "Latest".

## Related

- CLAUDE.md "## Versioning" step 5 (--notes-from-tag found wrong on v0.3.0)
- commit f57b03a
