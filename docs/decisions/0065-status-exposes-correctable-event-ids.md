# 0065. open and status expose the event ids a correction needs

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Corrections

## Context

The commands handed out entity ids only, so the agent was told to write SQL against `events` with json_extract. Every correction cost a `query --schema`, a guessed column, a failure (`no such column: opened_at`) and a retry. In the archive, 34 of 87 query calls hit FROM events and 11 were --schema.

run_open_event_id was added so the agent would stop hunting event ids with SQL, and reference/cli.md said flatly that it and session_open_event_id 'are the ids amend and revoke take'. But a run has two: platform, started_on and hours are on the opening event; rating, difficulty, note, outcome and completion_criteria are on the closing one. The agent patched `rating` onto a run.open, which reads neither field, and told the user it was recorded. The live log shows the regression: the same correction with the same reason text went to run.close correctly in August and to run.open twice in September, either side of the commit that added the field. The ugly SQL hunt searched for the event that carries the field, so it found the right one; the convenience replaced a search with a lookup and dropped the predicate.

## Decision

RunState/SessionState carry `open_event_id`, and open/status expose it, following the existing CheckinState.event_id pattern. It is a derived field on folded state, not a schema change (01-model.md untouched). It is deliberately not on `due`'s row: a check-in never amends a run or session, and widening every wake payload for a caller with no use for it is the wrong trade.

Expose run_close_event_id (on status) alongside run_open_event_id, and document per field which event takes the patch. Same shape as FROM v_sessions one level up: withholding the right name guarantees a guessed one, and here the guess exited 0.

## Consequences

Superseded in part by the 'Handing a caller one id where the domain has two' item. Exposing only run_open_event_id led the agent to patch closing fields onto run.open, so run_close_event_id was added to status. The body's 'open_event_id' framing is incomplete: a run now has two ids.

Paired with the amend refusal (next item), which makes the mistake fail loudly. A run filed by past/import carries both on one event, so the ids are equal.

## Related

- [src/core/fold.ts](../../src/core/fold.ts)
- [src/cli/commands/open.ts](../../src/cli/commands/open.ts)
- [src/cli/commands/status.ts](../../src/cli/commands/status.ts)
- [src/core/due.ts](../../src/core/due.ts)
- [agent/skills/gamereg/reference/cli.md](../../agent/skills/gamereg/reference/cli.md)
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [agent/skills/gamereg/reference/corrections.md](../../agent/skills/gamereg/reference/corrections.md)
- docs/spec/02-cli.md:338-344
