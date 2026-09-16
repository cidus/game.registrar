# 0057. An imported verdict is filed as its own run.verdict event

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Data model

## Context

run.verdict already exists as its own event type. Per 01-model.md, the note is what the run says about itself and the verdict is the considered opinion, written separately because it usually arrives later. A migrating register's review column is that considered opinion.

## Decision

import's `verdict` mapping field stages a run.verdict against the row's own run_id alongside its run.import, through the same `stage` helper verdict.ts uses. run.import's payload shape is unchanged.

## Consequences

No schema change. One extra event per row that has a verdict.

## Related

- [src/cli/commands/import.ts](../../src/cli/commands/import.ts)
- [src/cli/commands/verdict.ts](../../src/cli/commands/verdict.ts)
- [docs/spec/01-model.md](../spec/01-model.md)
