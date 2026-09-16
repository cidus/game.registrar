# 0031. The check-in wrapper files the check-in, after the wake succeeds

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Check-ins

## Context

The anti-nagging rules are a clock and a counter, which invariant 7 keeps out of the model. The agent would also have to remember a 45-minute deadline (reply_window) across turns, which a chat turn cannot do.

## Decision

agent/checkin.sh files the `snoozed` session.checkin for each due row, and only after `openclaw agent` returns 0. The agent only amends the outcome later (break_started / session_closed); `checkin --expire` amends to no_reply.

## Consequences

Filing before the wake would put a session in backoff without ever being asked, inverting the failure mode 02-cli.md chose. A repeat costs one message; a false silence costs a closing time nobody remembers. day_cutoff's exemption from the ladder and the ceiling makes the residual risk survivable.

## Related

- [agent/checkin.sh](../../agent/checkin.sh)
- [src/core/config.ts](../../src/core/config.ts)
- [src/core/due.ts](../../src/core/due.ts)
- [docs/spec/02-cli.md](../spec/02-cli.md)
- docs/spec/02-cli.md:431-436
