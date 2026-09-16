# 0021. The platform hint narrows the provider query, not the result page

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Providers

## Context

IGDB relevance for a family name is dominated by near-duplicates. `search "Super Mario"` opens with 15 e-Reader card levels and puts Super Mario World at rank 64 and Super Mario RPG at 103. Filtering the fetched window by platform afterwards returned 2 SNES entries out of a dozen. Two spellings were missing (Sega Mega Drive/Genesis, Sega Master System/Mark III), and `--platform genesis` returned nothing until they were added.

## Decision

provider.search receives every spelling of the hint and filters server-side by platform name (`where platforms.name = (...)`), never through a table of provider platform ids. core/platforms.ts already carries the catalogs' own spellings, which is the only reason this works. A narrowed search that comes back empty retries unnarrowed. Do not 'fix' relevance by raising SEARCH_FETCH_LIMIT: the wanted games are past any window worth fetching.

## Consequences

A spelling IGDB does not use costs relevance, not results (same judgement as the resolveGame retry). Correctness depends on the table carrying IGDB's spellings. search.ts still post-filters because a provider may ignore the hint.

## Related

- [src/providers/igdb.ts](../../src/providers/igdb.ts)
- [src/providers/provider.ts](../../src/providers/provider.ts)
- [src/cli/commands/search.ts](../../src/cli/commands/search.ts)
- [src/core/platforms.ts](../../src/core/platforms.ts)
- [test/platforms.test.ts](../../test/platforms.test.ts)
- docs/spec/03-resolution.md:164 (IGDB rank numbers)
