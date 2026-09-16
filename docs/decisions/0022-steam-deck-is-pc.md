# 0022. Steam Deck is a synonym of PC in the built-in platform table

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Platforms

## Context

No catalog lists Steam Deck as a platform (IGDB has none), so a separate entry would name a platform nothing could ever be resolved against.

## Decision

The built-in PC entry aliases Steam Deck (also SteamDeck, Deck, Steam, Windows, 'PC (Microsoft Windows)'). The trade-off was raised before it was done and chosen anyway.

## Consequences

Canonicalization runs on read, so Deck runs display as PC retroactively in the register. Declaring 'Steam Deck' in config.platforms takes it back, because the user's entry always wins, for the whole group.

## Related

- [src/core/platforms.ts](../../src/core/platforms.ts)
- [test/platforms.test.ts](../../test/platforms.test.ts)
