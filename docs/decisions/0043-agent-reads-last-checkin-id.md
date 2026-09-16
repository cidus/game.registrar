# 0043. The agent reads last_checkin_id from gamereg open

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Check-ins

## Context

02-cli.md used to say the id 'comes back in this command's own result.checkin_id'. That is true for the wrapper and impossible for the agent: the wake is enqueued before the check-in is filed, so when the question reaches a conversation the record does not exist.

## Decision

Put last_checkin_id on open's row (and due's row), the smallest fix that survives context compaction and a gateway restart.

## Consequences

`open` lists only open sessions, so an answer that closes the session must read the id first, before `end`.

## Related

- [src/cli/commands/open.ts](../../src/cli/commands/open.ts)
- [src/core/due.ts](../../src/core/due.ts)
- [docs/spec/02-cli.md](../spec/02-cli.md)
- [agent/skills/gamereg/reference/checkins.md](../../agent/skills/gamereg/reference/checkins.md)
