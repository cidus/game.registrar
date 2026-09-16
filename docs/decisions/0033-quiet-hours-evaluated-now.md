# 0033. Quiet hours are evaluated against the current time

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Check-ins

## Context

Both noticing triggers (duration, clock) stay fired once crossed; a threshold does not un-cross itself.

## Decision

Quiet hours are checked against the evaluation instant (now/--at). 'Held, not dropped' then needs no queue and no state: a trigger withheld at 03:00 is returned at 09:00 and merges into the morning message.

## Consequences

The rejected alternative, evaluating at the fire instant, would let a trigger that fired at 01:00 and was held by backoff until 03:00 be delivered inside the quiet window, the one thing quiet hours exist to prevent.

## Related

- [src/core/due.ts](../../src/core/due.ts)
- src/core/config.ts:92-97, :256-262 (quiet_hours is two times or none; a withheld trigger is held, not dropped)
