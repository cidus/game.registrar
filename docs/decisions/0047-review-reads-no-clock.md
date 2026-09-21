# 0047. A year in review reads no clock

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Stats and year in review

## Context

'Year in review' reads like an invitation to call Date.now. A build in December and one in January would then disagree, breaking non-negotiable 2 (idempotent build) through a feature nobody would think to test for it.

## Decision

Which years exist comes only from sessions in the log (their logical_day). A year is always drawn whole, January to December. Nothing in render or targets reads the clock.

## Consequences

test/stats-target.test.ts builds a log whose only sessions are in 2019 and asserts exactly one review note.

## Related

- [src/render/heatmap.ts](../../src/render/heatmap.ts)
- [src/render/review.ts](../../src/render/review.ts)
- [src/targets/stats.ts](../../src/targets/stats.ts)
- [test/stats-target.test.ts](../../test/stats-target.test.ts)
