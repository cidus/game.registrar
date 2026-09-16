# 0005. The platform list is a spelling table and a suggestion list, never a validator

- **Status:** Accepted
- **Date:** 2026-08-13
- **Area:** Platforms

## Context

Platforms are open-ended: consoles, handhelds, storefronts, emulators, a friend's PC. A closed list would refuse something real, and a free-text field alone leaves a long-lived register holding "SNES", "Super Nintendo" and "Super Famicom" as three different platforms.

## Decision

`config.platforms` is a spelling table and a suggestion list, never a validator. A platform anywhere in the system stays free text; the table canonicalizes spellings on input and again on read, and orders what gets offered. An unknown platform is recorded, not refused.

## Consequences

You can record a platform nobody has heard of, and it will be preserved exactly as typed.

Because canonicalization also runs on read, correcting a spelling in the table fixes history without touching the log.

The offered list is a convenience for menus, and its emptiness means "nothing configured", never "nothing allowed".

## Related

- docs/spec/02-cli.md:607-613 ("## Platform vocabulary")
- src/core/platforms.ts:133-139
- src/core/config.ts:29-34
