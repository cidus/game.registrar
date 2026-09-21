# 0016. obsidian/assets is a set of hardlinks, not a symlink

- **Status:** Accepted
- **Date:** 2026-08-19
- **Area:** Build and targets

## Context

The first implementation used a symlink, which works on macOS. Obsidian on Linux does not traverse it, so every embed silently showed nothing.

## Decision

mirrorAssets hardlinks assets/<shard>/<file> into obsidian/assets (and quartz/content/assets when images.publish is on), falls back to copying if a link cannot be made (separate mount, no hardlink support), and replaces its own earlier symlink. It only adds; nothing in gamereg deletes an ingested asset.

## Consequences

No extra disk (one inode, two names). Content-addressed names make a second build touch nothing. It stays outside the manifest, which keeps it clear of non-negotiable 9.

## Related

- [src/targets/mirror.ts](../../src/targets/mirror.ts)
- [src/targets/build.ts](../../src/targets/build.ts)
- [test/targets.test.ts](../../test/targets.test.ts)
- docs/spec/07-targets.md:173-181
