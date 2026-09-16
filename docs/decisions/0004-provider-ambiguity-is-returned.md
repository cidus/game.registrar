# 0004. Provider ambiguity is returned to the caller, never guessed

- **Status:** Accepted
- **Date:** 2026-08-13
- **Area:** Providers

## Context

Resolution against a catalog often yields several candidates. Unattended runs (cron) have nobody to answer.

## Decision

Interactive: a menu. Non-interactive: exit 3 with candidates[]. `--all` (and the `--missing` bulk selector) always collapses ambiguity to `skipped`, so cron never prompts.

## Consequences

Bulk runs leave ambiguous games unresolved for a later targeted enrich. The menu is only a presenter over the same candidate array.

## Related

- [src/cli/commands/enrich.ts](../../src/cli/commands/enrich.ts)
- [src/core/errors.ts](../../src/core/errors.ts)
- [src/resolve/resolve.ts](../../src/resolve/resolve.ts)
