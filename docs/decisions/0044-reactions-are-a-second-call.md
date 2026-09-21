# 0044. A reaction is a second tool call, mapped in a per-installation workspace file

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Chat channel

## Context

The spec said the mapping 'lives in the user's config'. On OpenClaw 2026.7.1-2 there is no config slot: MessagePresentationBlock is text | context | divider | buttons | select, with no sticker or reaction member, so a reaction cannot ride along with a reply the way an inline keyboard does, and the config schema has nowhere for a token table the model would read. What exists: action 'sendSticker' (needs fileId) and action 'react' (needs messageId and emoji), each behind its own switch, both off by default.

`sendSticker` (to, fileId) is gated by channels.telegram.actions.sticker and throws when off. `react` (messageId, emoji) is gated by actions.reactions and by reactionLevel above 'off', returning {ok: false, reason:'disabled'}. A Telegram file_id belongs to one bot.

## Decision

A reaction is a separate tool call. The token-to-asset table is agent/workspace/REACTIONS.md: the gateway's side of the line, copied per installation. The part of the original claim that mattered, not in the register's config and not in its log, is intact.

A reaction is a second message-tool call made after the command returns. No artwork ships. Both gateway switches ship commented out. The five tokens (filed, approved, archived, pending, puzzled) are identifiers, never translated.

## Consequences

As written: an emoji reaction is on a message, so with no concrete message id in hand, react with nothing. Superseded since: reference/media.md now says to leave messageId out, because omitting it targets the message being replied to. Also: react is gated twice (channels.telegram.actions.reactions and reactionLevel above 'off'); the emoji column ships filled and the sticker column empty; no reaction on a check-in wake.

Nothing happens until an operator enables the switches. The sticker column must be rebuilt after replacing the bot. A translated token matches no row and silently does nothing, indistinguishable from an empty installation, which is why the warning is repeated in several files.

## Related

- [agent/workspace/REACTIONS.md](../../agent/workspace/REACTIONS.md)
- [agent/skills/gamereg/reference/media.md](../../agent/skills/gamereg/reference/media.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- [docs/spec/05-agent.md](../spec/05-agent.md)
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
