# 0013. The committed SQLite cache is compared logically, not byte for byte

- **Status:** Accepted
- **Date:** 2026-08-16
- **Area:** Testing

## Context

SQLite's on-disk layout is not stable across library versions. A fixture committed from one Node version would fail on another with no difference in content.

## Decision

The golden test compares data/log.db through dumpDatabase (schema and contents). Every other artifact is compared as bytes. Determinism is still asserted on the bytes of a second build on the same machine.

## Consequences

Byte-level drift in the committed.db across SQLite versions is tolerated.

## Related

- [test/golden.test.ts](../../test/golden.test.ts)
- [test/dump-db.ts](../../test/dump-db.ts)
- [test/helpers.ts](../../test/helpers.ts)
- docs/spec/04-derived.md:396-423 (SQLite versions; per-target comparator)
- docs/spec/07-targets.md rule 3 (the "documented exception" wording)
