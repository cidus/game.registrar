# 0051. A rendering flavour is a record of answers, never a name

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Site and comments

## Context

The same folded state is rendered as Markdown for two consumers (Obsidian, Quartz).

## Decision

render/flavour.ts carries four booleans: siteFrontmatter (description/draft), assets (asset files present in the tree), qualifiedLinks (folder in wikilinks), prose (a heading for hand-written prose). Emitters read those and never branch on flavour.name. Every difference has to be stated as a property of the consumer, not a preference, which is what kept the list to four and keeps a fifth from being added casually.

## Consequences

Obsidian output did not move by a byte, proven by the example-vault golden files, which the refactor left untouched.

## Related

- [src/render/flavour.ts](../../src/render/flavour.ts)
- [src/render/note.ts](../../src/render/note.ts)
- [src/render/run.ts](../../src/render/run.ts)
- [src/render/table.ts](../../src/render/table.ts)
- [src/render/review.ts](../../src/render/review.ts)
- example-vault
