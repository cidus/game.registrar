# 0011. Platforms are canonicalized on input and on read

- **Status:** Accepted
- **Date:** 2026-08-16
- **Area:** Platforms

## Context

Adding a synonym later (e.g. 'Megadrive') should make runs recorded years ago render as one platform without rewriting the log.

## Decision

Canonicalize on input (flag, default, historical runs, amend, platform command) and again on read via canonicalizeState in planBuild, over a structuredClone of state. The read pass fixes history retroactively with no event.amend. fold stays pure over events and never sees the table. platform_raw keeps what was recorded.

## Consequences

A table edit re-renders all history. A bad canonicalization is always visible (platform_raw) and never destructive.

## Related

- [src/targets/build.ts](../../src/targets/build.ts)
- [src/core/platforms.ts](../../src/core/platforms.ts)
- [src/core/fold.ts](../../src/core/fold.ts)
- [src/cli/workspace.ts](../../src/cli/workspace.ts)
- [src/cli/historical-run.ts](../../src/cli/historical-run.ts)
- [src/cli/commands/amend.ts](../../src/cli/commands/amend.ts)
