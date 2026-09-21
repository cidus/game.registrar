# 0052. Site wikilinks name their folder; vault wikilinks do not

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Site and comments

## Context

Obsidian resolves [[hollow-knight]] by shortest match anywhere in the vault. Quartz resolves a wikilink from the content root by default (markdownLinkResolution), which the user may later change to anything.

## Decision

The site flavour emits [[games/hollow-knight]], which is exact under 'absolute' and falls back correctly under 'shortest'. The vault flavour emits bare names. The content therefore does not depend on a config key gamereg seeds once and never owns again.

## Consequences

Do not 'simplify' by seeding shortest and emitting bare names; that makes every link in a committed tree hostage to a file the user is invited to replace.

## Related

- [src/render/flavour.ts](../../src/render/flavour.ts)
- [templates/quartz.config.yaml](../../templates/quartz.config.yaml)
