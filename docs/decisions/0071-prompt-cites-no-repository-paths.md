# 0071. The deployed prompt cites no repository path

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Agent prompt

## Context

SKILL.md, SOUL.md, AGENTS.md, REACTIONS.md and reference/cli.md all pointed at docs/spec/* or test/*. The agent's workspace is ~/.openclaw/workspace/ and holds copies, not a checkout; nothing in its context names the repository. Across the whole session archive it never tried to read those paths, but it does guess paths when unsure, including seven reads of /home/claude/.openclaw/..., a home directory that does not exist on the host. The citations were inert at best and an invitation to a failed read at worst.

## Decision

Keep the claim a citation carried ('these flags are verified, trust them') and drop the path. A deployed file addresses the model; the reason a rule exists addresses the maintainer and belongs in the agent deployment notes or the project's working notes.

## Consequences

No test enforces this, and two deployed files still cite a repository path: agent/workspace/TOOLS.md:9 '(`agent/openclaw.example.json5`)' and agent/workspace/REACTIONS.md:44 '`agent/openclaw.example.json5` in the gamereg repository'. TOOLS.md is replaced every boot, so the path ships on every install. The rule is in force but only partly honored; a grep-based test would hold it.

## Related

- agent/workspace
- agent/skills/gamereg
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
