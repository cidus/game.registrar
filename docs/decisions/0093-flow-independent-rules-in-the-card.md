# 0093. Rules that apply in every flow live in the always-loaded card

- **Status:** Accepted
- **Date:** 2026-09-11
- **Area:** Agent prompt

## Context

'Strip the button once answered' was written into reference/checkins.md, which is correct but useless. The user answered a live check-in by asking for the session to be revoked; the router sent the agent to reference/corrections.md, and it never opened the check-in file. It stripped its own confirmation button perfectly and left the check-in's buttons up.

## Decision

Anything that must happen whatever flow the agent is in goes in workspace/AGENTS.md, which is in context regardless of routing. Branch files may only carry what is true inside their own flow.

## Consequences

The triggering case is moot: check-ins no longer carry buttons (next item). The rule was also shown to be necessary but not sufficient: even in AGENTS.md, a 'strip a stale button from an earlier turn' rule failed (next item). It still holds for same-turn obligations, e.g. stripping an answered confirmation button, which lives in AGENTS.md.

## Related

- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [agent/skills/gamereg/reference/checkins.md](../../agent/skills/gamereg/reference/checkins.md)
- [agent/skills/gamereg/reference/corrections.md](../../agent/skills/gamereg/reference/corrections.md)
