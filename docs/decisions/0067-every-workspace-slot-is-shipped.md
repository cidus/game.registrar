# 0067. Every workspace slot is shipped, so the prompt budget measures the whole prompt

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Agent prompt

## Context

workspace/TOOLS.md was removed once tools.allow made its content structurally true. Within the hour OpenClaw seeded its own default back: a generic page about camera names, SSH hosts and TTS voices, which then sat in the system prompt every turn describing capabilities this deployment does not have.

test/agent-skill.test.ts's budget covered agent/workspace/*.md in the repository, but a live gateway also held USER.md (OpenClaw's generic 'update this as you go' template) and DREAMS.md: 4,337 bytes against 29,274 measured, on a real prompt of 33,314. DREAMS.md is the visible half of memory-core's `dreaming` sweep, on by default: two phases a night consolidate memory from session corpora, and a model writes a narrative diary entry into the workspace, so it grows by an entry per phase per night inside the cached prompt (two nights came to 3,800 bytes). It also contradicts a rule in the same prompt ('no notes, no session history; the register is the memory').

## Decision

The slot is occupied either way; choose what fills it. TOOLS.md is back, short, and says why in its own header so the next session does not re-derive it. The same rule was later applied to USER.md and HEARTBEAT.md.

HEARTBEAT.md and USER.md are claimed (shipped) so the deployed set equals the shipped set and the budget measures the whole prompt. An existing DREAMS.md is moved out of the workspace, not deleted. A budget over a subset is not a budget, and the subset is invisible from inside the repository.

## Consequences

Every file in the deployed prompt is a file in agent/workspace/, which is what makes the size budget meaningful. TOOLS.md is now replaced on every boot (WORKSPACE_REPLACE). The entrypoint also runs onboard with --skip-bootstrap so OpenClaw does not seed defaults ahead of the shipped files.

The budget constant rose 30,000 to 32,000 while the real total fell ~3KB and stopped self-growing.

## Related

- [agent/workspace/TOOLS.md](../../agent/workspace/TOOLS.md)
- [agent/workspace/HEARTBEAT.md](../../agent/workspace/HEARTBEAT.md)
- [agent/workspace/USER.md](../../agent/workspace/USER.md)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
