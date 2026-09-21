# 0058. A future Astro generator is fed a nested projection, never data/export.json

- **Status:** Proposed
- **Date:** 2026-08-23
- **Area:** Site and comments

## Context

Astro would sit alongside Quartz, not replace it; the site-to-quartz rename made room for it. Quartz is a document publisher (Markdown in, linked site out); Astro is a framework (data in, whatever you design out). Given the Quartz flavour, Astro would be capped at what frontmatter carries, and the interesting fields are already structured. The `html` target is the precedent: it embeds JSON and builds its table in the browser. data/export.json exists, is committed, and 07-targets.md calls it 'for the site'. But it carries no cover, no genres, no game platforms, no run.note and no verdict, because its contract is to mirror the SQLite tables column for column, and genres and platforms live in join tables the flattening drops.

## Decision

A future Astro path gets its own nested projection target: each game with its platforms, genres, cover and runs, each run with its verdict, note and sessions. Field names come from the SQLite schema, which stays the authority. data/export.json must not be widened into that artifact: widening breaks its spreadsheet usefulness and contradicts 04-derived.md's rule that the SQLite schema wins any disagreement. With data, gamereg says what is true and the site decides which pages exist, so gamereg does not dictate a downstream site's URL structure, and cross-cutting pages (by year, genre, platform) and charts need no new artifact. That target is cheaper than quartz: no remark, frontmatter, markers or splice, just a projection.

## Consequences

Nothing is scheduled. Build the site before the target, since the projection's shape is the risky part and only a real consumer de-risks it (the same lesson as phase 0's exit criterion). A new target is on the project's working notes 'ask first' list.

## Related

- [src/targets/json.ts](../../src/targets/json.ts)
- [docs/spec/07-targets.md](../spec/07-targets.md)
- [docs/spec/04-derived.md](../spec/04-derived.md)
- [src/targets/html.ts](../../src/targets/html.ts)
