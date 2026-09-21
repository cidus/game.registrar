# 0030. Build cleanup stays one manifest whitelist, not a per-target policy

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Build and targets

## Context

Proposed once: per-target deletion policies, on the grounds that a target knows its own artifacts and.obsidian/ must survive a build.

## Decision

Keep one central rule: the build deletes only files the manifest records a target as owning and no longer planning, and never anything when the manifest is missing. .obsidian/ already survives because it is not in the manifest, so it is never a candidate.

## Consequences

One auditable rule instead of N, in the only part of the system that deletes. Failure modes are asymmetric: a wrong central rule deletes nothing, a wrong per-target policy deletes somebody's.obsidian/.

## Related

- [src/targets/build.ts](../../src/targets/build.ts)
- [src/targets/manifest.ts](../../src/targets/manifest.ts)
- [docs/spec/07-targets.md](../spec/07-targets.md)
- docs/spec/07-targets.md:126-138
