# 0050. The prose of a year in review has no command

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Stats and year in review

## Context

The agent can draft a year-in-review opening paragraph the way it drafts a verdict.

## Decision

No `review` command and no event. The agent writes no files; an accepted paragraph is text the user pastes into the note outside the gamereg markers, where invariant 3 keeps it through every later build. The build never generates prose.

## Consequences

Filing it would need a new event type, a schema change bought for a nicety. The argument that puts a verdict in the log (the record's own opinion of a playthrough) does not obviously carry to a year, which is a view over the record, not a thing in it. Reopen if pasting turns out to be what stops the feature being used.

## Related

- [docs/spec/05-agent.md](../spec/05-agent.md)
- [agent/skills/gamereg/reference/query.md](../../agent/skills/gamereg/reference/query.md)
- src/cli/commands
- docs/spec/04-derived.md:371-377
- docs/spec/05-agent.md:591-596
