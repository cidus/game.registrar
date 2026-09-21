# 0038. The site target is named quartz and writes quartz/

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Site and comments

## Context

Naming the static-site target. A future Astro generator is possible.

## Decision

The target is named quartz and writes quartz/. First reason: precedent, since obsidian is also named for its consumer and writes a whole tree into a directory of the same name. Second: a target that emits quartz.config.yaml is not a generic site builder, and taking the generic name would leave a future Astro target nowhere to write, because two targets planning one path is a hard error (error.target_conflict), so site/ could never be shared. Renamed before implementation.

## Consequences

Per 06-roadmap.md, target names are free to move only until the distribution phase; after it a rename is a migration owed to a stranger.

## Related

- [src/targets/registry.ts](../../src/targets/registry.ts)
- [src/targets/build.ts](../../src/targets/build.ts)
- [src/targets/quartz.ts](../../src/targets/quartz.ts)
- [docs/spec/07-targets.md](../spec/07-targets.md)
- [docs/spec/06-roadmap.md](../spec/06-roadmap.md)
