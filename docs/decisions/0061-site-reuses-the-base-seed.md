# 0061. The site reuses the Game Database.base seed unchanged

- **Status:** Accepted
- **Date:** 2026-08-26
- **Area:** Site and comments

## Context

The expectation was that tags, which the seed matches with file.hasTag('gamereg'), would need a fifth Flavour boolean the way assets gates cover. Reading render/run.ts runFrontmatter showed set('tags', ['gamereg', 'gamereg/run']) is unconditional in both flavours, as is everything else the.base reads (status, platform, genres, hours...). Only cover is flavour-gated, correctly, through flavour.assets, the same gate as the note header embed. Checked against a real Quartz 5.0.0: @quartz-community/bases-page, already enabled in the seeded config, renders the.base as a themed, sortable table chained from the config palette.

Checked against a real Quartz 5.0.0 checkout: @quartz-community/bases-page, already enabled in the seeded config, renders the.base as a themed sortable table. Every property and filter the seed uses is flavour-independent, so render/ needed no change.

## Decision

quartz.ts pushes one more file, content/Game Database.base, with policy 'seed', reusing template('Game Database.base') verbatim. No new Flavour field and no render/ change.

Reuse the Obsidian seed verbatim for the site; add no Flavour field.

## Consequences

A boolean for a difference that does not exist would be the casually added fifth field the flavour design warns against.

If a future.base property is flavour-gated (as cover is), revisit.

## Related

- [src/targets/quartz.ts](../../src/targets/quartz.ts)
- [src/render/run.ts](../../src/render/run.ts)
- [src/render/flavour.ts](../../src/render/flavour.ts)
- templates/Game Database.base
- example-vault/quartz/content/Game Database.base
- [templates/quartz.config.yaml](../../templates/quartz.config.yaml)
