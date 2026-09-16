# 0032. due returns at most one row per session, day_cutoff first

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Check-ins

## Context

Several triggers are fired at once far more often than a per-trigger reading suggests. A session open past 4h at 09:00 the next morning has all three. Returning all of them would file three check-ins and send three messages about one session, the nagging the feature exists to avoid.

## Decision

At most one row per session per tick. Priority: day_cutoff (chases data nobody has) > duration (knows how long the session ran) > clock (only knows the time). The backoff ladder is measured from the last check-in of any trigger, since a chase is still a message that just arrived.

## Consequences

day_cutoff is exempt from both the ladder and the ceiling and is bounded only by being asked once per delivery slot (chase_at): one chase per morning, so a session open for three days is chased three times, not hourly.

## Related

- [src/core/due.ts](../../src/core/due.ts)
- [test/due.test.ts](../../test/due.test.ts)
- [docs/spec/02-cli.md](../spec/02-cli.md)
