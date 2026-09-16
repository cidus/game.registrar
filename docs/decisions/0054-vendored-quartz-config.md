# 0054. The seeded quartz.config.yaml is Quartz's obsidian template, vendored

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Site and comments

## Context

A hand-written minimal configuration: block was tried first and Quartz 5 failed to emit from it. theme has no deep default, so a partial config is not a smaller config but a broken one.

## Decision

Seed Quartz's own obsidian template, whose link resolution and Obsidian-flavored Markdown match what the target emits. Only the site identity is changed (title, base URL, no analytics). Policy seed: it becomes the user's the moment they touch it; `npx quartz create` may replace it wholesale; `gamereg build --force` restores the default.

## Consequences

Vendoring is cheap, not maintenance debt. Verifying a change to it means running Quartz, which gamereg never does, so this file is untested by CI.

## Related

- [templates/quartz.config.yaml](../../templates/quartz.config.yaml)
- [src/targets/quartz.ts](../../src/targets/quartz.ts)
