# 0027. example-vault carries two real WebP assets that are never regenerated

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Testing

## Context

Golden tests for rendering should not depend on image encoder output.

## Decision

example-vault/ commits two real WebP assets that are never regenerated. A rendering golden test touches only the event log and string arithmetic, never the encoder.

## Consequences

sharp version drift cannot move the hashes. Ingest determinism is tested separately.

## Related

- example-vault/assets
- example-vault/obsidian/assets
- [test/golden.test.ts](../../test/golden.test.ts)
- [test/ingest.test.ts](../../test/ingest.test.ts)
