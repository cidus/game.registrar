# 0077. The installable release ships as 1.0.0, before board games

- **Status:** Accepted
- **Date:** 2026-09-01
- **Area:** Versioning and releases

## Context

Phase 3's exit criterion wants a page a stranger can open, which is hosting, so the installability phase could not wait behind a second category of game.

## Decision

Phase 4 (someone else's machine) comes before board games. Board games moves to After 1.0 because it is additive by design (D6). Phase 4 is the last numbered phase and ships as 1.0.0.

## Consequences

The 1.0.0 release does not wait on board games, which lands as 1.1.0. Phase-number citations in code and specs broke, which led to the no-phase-numbers rule and test/phase-citations.test.ts.

## Related

- [docs/spec/06-roadmap.md](../spec/06-roadmap.md)
- [package.json](../../package.json)
- [test/phase-citations.test.ts](../../test/phase-citations.test.ts)
- [docs/spec/00-architecture.md](../spec/00-architecture.md)
- docs/spec/06-roadmap.md:106-114, 129-134
- CLAUDE.md "## Versioning" first paragraphs
