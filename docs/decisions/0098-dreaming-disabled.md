# 0098. memory-core dreaming is disabled

- **Status:** Accepted
- **Date:** 2026-09-13
- **Area:** Agent prompt

## Context

test/agent-skill.test.ts's budget covered agent/workspace/*.md in the repository, but a live gateway also held USER.md (OpenClaw's generic 'update this as you go' template) and DREAMS.md: 4,337 bytes against 29,274 measured, on a real prompt of 33,314. DREAMS.md is the visible half of memory-core's `dreaming` sweep, on by default: two phases a night consolidate memory from session corpora, and a model writes a narrative diary entry into the workspace, so it grows by an entry per phase per night inside the cached prompt (two nights came to 3,800 bytes). It also contradicts a rule in the same prompt ('no notes, no session history; the register is the memory'). The clincher: tools.allow is exec/message/read, so the agent cannot query the memory the sweep builds. A nightly model run bought an unreachable archive and delivered forbidden prose.

## Decision

Dreaming is off. HEARTBEAT.md and USER.md are claimed (shipped) so the deployed set equals the shipped set and the budget measures the whole prompt. An existing DREAMS.md is moved out of the workspace, not deleted. A budget over a subset is not a budget, and the subset is invisible from inside the repository.

The boot overlay sets `plugins.entries.memory-core.config.dreaming.enabled: false` on every boot.

## Consequences

The budget constant rose 30,000 to 32,000 while the real total fell ~3KB and stopped self-growing. Gap: dreaming is disabled only by the container entrypoint. agent/openclaw.example.json5 (host install) carries no dreaming setting and the agent deployment notes host Setup does not mention it, so a host install still gets the sweep.

No memory consolidation.

## Related

- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
- [0106](0106-only-the-injected-set-is-shipped.md) — HEARTBEAT.md is no longer shipped, for the same reason DREAMS.md is not
- [agent/workspace/USER.md](../../agent/workspace/USER.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
