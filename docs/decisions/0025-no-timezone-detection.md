# 0025. The logical day needs no timezone detection and no per-invocation override

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Data model

## Context

Grouping sessions by day under travel; the recorded timestamps already carry their offset.

## Decision

logical_day is derived on every fold. With config.timezone unset, days group by the local day recorded (the offset is already in the log). With a zone set, everything is projected into it. There is no timezone detection and no per-invocation override flag.

## Consequences

Both modes are stable under travel. Only editing config.timezone regroups history.

## Related

- [src/core/config.ts](../../src/core/config.ts)
- [src/core/time.ts](../../src/core/time.ts)
- [src/core/fold.ts](../../src/core/fold.ts)
- [docs/spec/01-model.md](../spec/01-model.md)
- docs/spec/06-roadmap.md "## Decided" item 4
- docs/spec/01-model.md:353-356
