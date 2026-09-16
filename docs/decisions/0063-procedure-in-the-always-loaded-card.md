# 0063. The common procedure lives in the always-loaded card; rare flows are read on demand

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Agent prompt

## Context

OpenClaw compiles workspace/*.md into the system prompt once and caches it; a skill body is a `read` tool call paid for mid-turn, per session. So SOUL.md (persona) was resident every turn while SKILL.md (the actual procedure) was bought again each session at ~14k tokens, sometimes twice in one conversation. The archive showed SKILL.md read 38 times.

Trajectory logs showed four things. 39 tools with 53,768 chars of schemas against a 45,615-char system prompt, for an agent that uses 3. sessions_history and memory_search called despite prose forbidding them. SKILL.md read 38 times at ~14k tokens, because a skill is an on-demand read while workspace/*.md is cached in the system prompt. 87 of 361 exec calls were query, 34 of those FROM events and 11 --schema, i.e. hunting event ids.

## Decision

Move rather than shorten first: the common path goes into workspace/AGENTS.md (always in context), rare flows into skills/gamereg/reference/*.md, loaded only when that flow happens. SKILL.md becomes a router pointing back to the card. Do not merge them back into one big SKILL.md; the split is the mechanism.

Restrict tools with tools.allow. Put the always-needed procedure in the cached workspace card (AGENTS.md) and the rare flows in on-demand reference/*.md. Expose event ids from CLI commands so no SQL hunting is needed.

## Consequences

A test asserts every routed reference file exists and every existing one is routed to, so no file is orphaned silently. The trade: AGENTS.md is large and paid every turn, so it needs the size budget (see the 'A correction states the rule' item).

The gateway needs a restart for tools.allow. Moving rules between workspace/ and skills/ has a measured cost. Do not re-merge into one big SKILL.md. The workspace size budget test holds the line.

## Related

- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [agent/skills/gamereg/SKILL.md](../../agent/skills/gamereg/SKILL.md)
- agent/skills/gamereg/reference
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
- [agent/README.md](../../agent/README.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- [src/cli/commands/open.ts](../../src/cli/commands/open.ts)
- [src/cli/commands/status.ts](../../src/cli/commands/status.ts)
