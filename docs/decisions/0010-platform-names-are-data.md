# 0010. Built-in platform names are data, not interface text

- **Status:** Accepted
- **Date:** 2026-08-16
- **Area:** Platforms

## Context

Project convention: all user-facing strings come from i18n/, no hardcoded English in src/.

## Decision

Platform names in core/platforms.ts are data, the one deliberate exception. The table also carries providers' own spellings, which is what makes catalog intersection work without provider platform ids.

## Consequences

Platform names are not localized. The table has to track catalog spellings.

## Related

- [src/core/platforms.ts](../../src/core/platforms.ts)
