# 0102. A break returns `duration` to `Silent`

- **Status:** Accepted
- **Date:** 2026-09-20
- **Area:** Check-ins

## Context

`duration` was measured from `session.open` against the wall clock. Nothing in
the fold could un-cross it, so a session filed at 20:00 that went on a break at
21:00 and came back at midnight was still "four hours in" at 00:30 — 31 minutes
of play — and the question arrived offering a pause the user had just taken.
Worse, a poll landing *during* a break returned the row with `on_break: true`:
the one message whose subject is a pause, sent to someone already paused.

The spec had already described the intended behaviour and the code had never
implemented it: `docs/spec/05-agent.md`'s state machine carries
`Asked → BreakStarted → Silent`, and the evaluator had no way to reach `Silent`
again once the threshold was crossed. The tests agreed with the code — the row
was asserted during an open break — which is how a broken transition survives a
suite that reads as thorough.

## Decision

`duration` measures the **stretch** of play with no break in it: from the
opening, or from the end of the last break since. `uninterrupted_minutes` in the
`open`/`due` rows is that number, live while the session plays and frozen at the
break that paused it; `open_for_minutes` and `net_minutes` keep their own
meanings.

Two rules, both in `src/core/due.ts`:

1. A break that ended moves the anchor forward. The crossing the break made moot
   is never delivered — `Asked → BreakStarted → Silent`, not `→ Withheld`.
2. An open break returns nothing. `clock` and `day_cutoff` are *not* held by one,
   since neither is offering a pause: a session left open and forgotten is
   exactly what `day_cutoff` is for.

## Consequences

This is a deliberate exception to [ADR 0033](0033-quiet-hours-evaluated-now.md):
for `duration` alone, the threshold *does* un-cross itself. The reason is that a
break is the outcome this trigger hopes for — punishing it with a question
minutes later is the nagging the whole feature is built to avoid. `duration`
therefore reaches `Silent` twice: once at the break, once when the session
closes. The backoff ladder and the ceiling are unaffected and still measured
from the last check-in of any trigger, so a session with three breaks in it does
not get three times the questions for free.

Reopening this requires a user saying the question arrived too *late*: a session
played for two hours, broken for six, and played again is two stretches, and the
first one was never asked about. That cost is accepted — the ledger has the
session and the breaks, and the number that would have been asked about is
recoverable from `net_minutes`.

## Related

- [src/core/due.ts](../../src/core/due.ts) — `fireDuration`, `evaluate`
- [src/core/fold.ts](../../src/core/fold.ts) — `stretchStart`, `uninterruptedMinutes`
- [test/due.test.ts](../../test/due.test.ts) — the stretch rows
- [docs/spec/05-agent.md](../spec/05-agent.md) — *Triggers*, the state machine
- [docs/reference/configuration.md](../reference/configuration.md) — `checkin.after`
