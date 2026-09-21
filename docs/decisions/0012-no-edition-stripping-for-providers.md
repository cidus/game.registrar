# 0012. Edition suffixes are not stripped when matching against a provider

- **Status:** Accepted
- **Date:** 2026-08-16
- **Area:** Resolution

## Context

A catalog lists an edition (e.g. 'Deluxe Edition') as its own entry with its own id.

## Decision

Provider matching in enrich normalizes with { editions: false }. Local resolution keeps stripping on, so a locally typed 'Skyrim Special Edition' still matches a local 'Skyrim'.

## Consequences

Stripping on the provider side would falsely collide an edition with its base game.

## Related

- [src/resolve/normalize.ts](../../src/resolve/normalize.ts)
- [src/cli/commands/enrich.ts](../../src/cli/commands/enrich.ts)
- [docs/spec/03-resolution.md](../spec/03-resolution.md)
