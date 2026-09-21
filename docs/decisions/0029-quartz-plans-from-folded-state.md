# 0029. The quartz target plans from folded state and never runs Quartz

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Site and comments

## Context

An earlier 07-targets.md draft had quartz run Quartz over the finished vault. That made it 'the one target that reads what the others wrote' and put invariant 8 in permanent contradiction with itself.

## Decision

Make the claim false rather than weaken the invariant. quartz plans its own content from folded state. gamereg never runs Quartz: it emits the input and stops.

## Consequences

Cost: a flavour parameter through render/. Bought: invariant 8, D8 and non-negotiable 8 stay absolute, and the build spawns no subprocess. Do not 'reunify' by having quartz read obsidian/; that restores the bug.

## Related

- [src/targets/quartz.ts](../../src/targets/quartz.ts)
- [src/render/flavour.ts](../../src/render/flavour.ts)
- [docs/spec/07-targets.md](../spec/07-targets.md)
- [docs/spec/00-architecture.md](../spec/00-architecture.md)
- docs/spec/07-targets.md:294-300
