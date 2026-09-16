# 0024. A user cover is never fetched or replaced by enrichment

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Photos and covers

## Context

Users set covers from their own photos, and game.enrich events changed shape over time: the cover field went from a bare URL to { url, sha256? }.

## Decision

A cover with source 'user' is never fetched and never replaced by enrichment, not even with --covers --force. Only `gamereg cover --reset` gives provider art back. The fold reads game.enrich's cover as both a bare URL string and { url, sha256? } forever, because the append-only log keeps old events.

## Consequences

The fold carries a permanent dual-shape reader.

## Related

- [src/cli/commands/enrich.ts](../../src/cli/commands/enrich.ts)
- [src/cli/commands/cover.ts](../../src/cli/commands/cover.ts)
- [src/core/fold.ts](../../src/core/fold.ts)
