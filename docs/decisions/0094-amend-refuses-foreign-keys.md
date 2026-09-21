# 0094. amend refuses a patch key the target event does not carry

- **Status:** Accepted
- **Date:** 2026-09-13
- **Area:** Corrections

## Context

The patch is a shallow merge, and the fold takes each field from the event that owns it, so a foreign key writes nothing yet reports success, with the patch echoed back in `result` where it reads as confirmation. Two such amends are in the live log, and a third class was possible: `--set minutes=1985`, derived state the fold computes and never reads back (invariant 7).

Raised with the amend refusal: the live log still holds amends with foreign keys accepted before the refusal existed.

## Decision

amend validates every patch key against a per-type field list (EVENT_FIELDS in core/events.ts) and exits 2 (usage), naming the field, the type and the allowed fields. Cost accepted: a second field list that can drift from 01-model.md, the same trade doctor's ENUM_FIELDS makes. test/amend.test.ts checks the spec's payload tables in one direction and example-vault's log in the other, so drift fails in CI. amend is the one escape hatch of an append-only log, and strictness there feels like closing the exit; it is the reverse, because a log with no delete is exactly where a silent no-op write cannot be taken back. The command whose whole job is fixing a mistake is the last one that should accept one quietly.

Declined. They are inert (the fold already ignores them); the data they failed to write has since been written correctly; and no report could suggest a fix, because an append-only log cannot drop them and revoking changes nothing since they never applied.

## Consequences

Adding or renaming an event payload field requires updating EVENT_FIELDS and 01-model.md together, or CI fails. A refused amend appends nothing.

A permanent two-line complaint with no action attached would recreate the false-positive problem the ENUM_FIELDS fix had just cleared out (commit 85d58a2, doctor checking a check-in's outcome against its own list). Reopen only if such amends start to matter to a reader of doctor.

## Related

- [src/cli/commands/amend.ts](../../src/cli/commands/amend.ts)
- [src/core/events.ts](../../src/core/events.ts)
- [test/amend.test.ts](../../test/amend.test.ts)
- [docs/spec/01-model.md](../spec/01-model.md)
- [src/cli/commands/doctor.ts](../../src/cli/commands/doctor.ts)
