# 0039. A check-in wake is handed the routing, session and language it cannot infer

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Check-ins

## Context

All three were found watching a real check-in, and none fails loudly. (1) Delivery target: an inbound-message turn gets the conversation target injected; a poll-started turn does not. The agent used target 'telegram', which resolved to @telegram, the public channel, and was stopped only because the bot was not a member. (2) Session: `openclaw agent` has no implicit main session and refuses without --agent ('No target session selected'). (3) Language: with nothing written, 'reply in whatever they wrote' has no input; the agent searched session history and memory and answered in the wrong language.

## Decision

The wrapper passes --reply-channel/--reply-to (from GAMEREG_CHECKIN_CHANNEL/_TO), and the prompt forbids naming a target. It always passes --agent (OPENCLAW_AGENT, default main). It states the register's configured locale (from `gamereg vocab --json`) as a fact. Rule: the gateway's implicit context belongs to an inbound message, not to a session; anything the agent normally infers must be handed to it.

## Consequences

Every new poll-started flow must supply routing, session and language explicitly.

## Related

- [agent/checkin.sh](../../agent/checkin.sh)
- [agent/skills/gamereg/reference/checkins.md](../../agent/skills/gamereg/reference/checkins.md)
- [agent/skills/gamereg/reference/media.md](../../agent/skills/gamereg/reference/media.md)
