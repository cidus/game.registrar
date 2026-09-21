# 0048. Hours in a year are measured hours only

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Stats and year in review

## Context

A session has a logical day. Stated hours, from import or --hours / a run.open hours baseline, belong to a run and to no day.

## Decision

Year and heatmap figures count only measured session minutes by logical day. Stated hours count in overall totals and in the game's note, not in any year.

## Consequences

A migrated register shows years emptier than they were, which is true: nobody recorded those days. Do not 'fix' this by spreading a run's stated hours across its date range; that invents days.

## Related

- [src/render/heatmap.ts](../../src/render/heatmap.ts)
- [src/render/review.ts](../../src/render/review.ts)
- [src/core/fold.ts](../../src/core/fold.ts)
