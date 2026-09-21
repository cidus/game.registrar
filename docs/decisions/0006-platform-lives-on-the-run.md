# 0006. Platform lives on the run, not on the session

- **Status:** Accepted
- **Date:** 2026-08-13
- **Area:** Data model

## Context

A playthrough usually happens on one platform, but not always: a save moves between a console and a handheld, or a PC game is finished on a laptop. The field could live on the run or on the session, and the choice was left open until real use settled it. It never came up.

## Decision

`platform` belongs to the run. Sessions do not carry one.

## Consequences

A run genuinely split across two platforms records the one it is filed under. If that ever becomes common, the answer is a second run rather than a field on the session — runs already exist for exactly this kind of division.

Do not use a run's platform as evidence when deciding whether a game "exists" on a platform: that is what the catalog is for, and conflating them reintroduces duplicate game records.

## Related

- docs/spec/06-roadmap.md "## Decided" item 2
