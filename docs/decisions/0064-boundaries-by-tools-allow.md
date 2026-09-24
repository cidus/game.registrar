# 0064. The agent's boundary is enforced with tools.allow, not prose

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Agent prompt

## Context

AGENTS.md and SKILL.md both forbade, in bold, reading session history and keeping notes, yet live transcripts showed `sessions_history` 7 times and `memory_search` 3 times. The latter returned a broken-index error carrying its own instructions for the model to relay to the user. 39 tool schemas cost ~13k tokens per turn (53,768 characters against a 45,615-character system prompt) for an agent that uses three.

## Decision

When a rule and an affordance disagree, remove the affordance: `tools.allow: ["exec", "message", "read"]`. The gateway must be restarted for tools.allow to take effect; there is no config-reload path.

## Consequences

Each surviving tool must be argued for: exec runs gamereg, message sends buttons/covers/reactions, read loads the skill (denying it breaks skill loading). The same lesson later justified disabling dreaming (the agent cannot reach memory tools anyway). The lesson generalizes beyond this repo.

## Related

- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- [agent/README.md](../../agent/README.md)
- [0106](0106-only-the-injected-set-is-shipped.md) — TOOLS.md stopped being injected in OpenClaw 2026.9.4 and its notes moved into the card
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
