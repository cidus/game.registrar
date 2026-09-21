# 0053. The front page is index.md on the site and Game List.md in the vault

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Site and comments

## Context

The consolidated table is the register's front page in both consumers.

## Decision

Same block, same renderer (newTable), two file names. quartz/content/index.md, because index is Quartz's landing page. obsidian/Game List.md, because Obsidian's quick switcher shows a basename and 'index' says nothing there.

## Consequences

Two names because two readers.

## Related

- [src/targets/quartz.ts](../../src/targets/quartz.ts)
- [src/targets/obsidian.ts](../../src/targets/obsidian.ts)
- [src/render/table.ts](../../src/render/table.ts)
