# 0003. Obsidian Bases are supported; Dataview is not

- **Status:** Accepted
- **Date:** 2026-08-12
- **Area:** Build and targets

## Context

Obsidian users query their vault in two ways. Dataview is a community plugin with its own query language embedded in code blocks; Bases is first-party and reads the frontmatter a note already carries. The register writes structured frontmatter on every note it generates — status, platform, genres, hours, rating — so the data for a table exists either way.

## Decision

Ship a seeded `Game Database.base` and keep the frontmatter complete. Generate no Dataview queries.

## Consequences

Anyone who prefers Dataview can write their own queries against the same frontmatter, and nothing in the build interferes with them.

gamereg maintains one query surface rather than two, and does not depend on a community plugin staying compatible.

## Related

- docs/spec/07-targets.md:442-447 ("## Dataview")
