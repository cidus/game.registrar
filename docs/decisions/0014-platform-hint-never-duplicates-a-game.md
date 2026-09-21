# 0014. The platform hint may cost a filter, never a duplicate record

- **Status:** Accepted
- **Date:** 2026-08-18
- **Area:** Resolution

## Context

An empty game.platforms (e.g. created with --no-metadata, never enriched) used to count as 'exists nowhere'. `start "<exact title>" --platform x` then returned not_found. start/past resolve with allowCreate, so the next step filed a second record of a game already on record, splitting history in an append-only log (costs a revoke).

## Decision

An empty game.platforms is silence and never filters (matchesPlatform). When the hint alone empties the resolution pool, resolveGame retries without it. Do not use game.runs[].platform as evidence: that reintroduces the bug for anyone replaying on a new console.

## Consequences

The hint sometimes fails to narrow. Only a genuine absence reaches the create path.

## Related

- [src/resolve/resolve.ts](../../src/resolve/resolve.ts)
- [src/cli/workspace.ts](../../src/cli/workspace.ts)
- [test/resolve.test.ts](../../test/resolve.test.ts)
- [docs/spec/03-resolution.md](../spec/03-resolution.md)
- docs/spec/03-resolution.md:143-162
