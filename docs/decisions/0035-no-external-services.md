# 0035. No external service beyond IGDB is integrated

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Providers

## Context

Candidates considered: HowLongToBeat and Backloggd have no official API. Steam and console playtime are the deferred automatic playtime detection and fall under the 'not a library manager' non-goal, so they are a product question, not a scope one. IGDB's game_time_to_beats was cheap (same credentials, same client, one extra query).

## Decision

Integrate no external service beyond IGDB. game_time_to_beats was declined because it needs a new game.enrich field, and a phase does not buy a schema change for a nicety.

## Consequences

If ever wanted, game_time_to_beats is the only candidate worth reopening. It would be a schema change to ask about first.

## Related

- [src/providers/igdb.ts](../../src/providers/igdb.ts)
- [src/providers/registry.ts](../../src/providers/registry.ts)
- [docs/spec/06-roadmap.md](../spec/06-roadmap.md)
- [docs/spec/00-architecture.md](../spec/00-architecture.md)
