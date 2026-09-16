# 0018. Telegram buttons use a raw value, never the callback action

- **Status:** Accepted
- **Date:** 2026-08-19
- **Area:** Chat channel

## Context

On openclaw 2026.7.1-2, three button shapes exist and only one delivers a tap. `action:{type:"callback"}` is wrapped in a checksummed `tgcb1:` envelope (buildTelegramOpaqueCallbackData) that the inbound handler drops before the tap becomes a message, while answerCallbackQuery still stops the spinner. `action:{type:"command"}` arrives as `/x`. A bare `value` arrives as `callback_data: <value>`. Both the docs and the gateway's injected prompt push toward the dead shape. Four more facts were read from the installed package: values over 64 bytes are silently dropped (sanitizeTelegramCallbackData); rows hold three buttons; buttons attach only to the first media item (deliverMediaReply); a tap carries the media of the message it was on (buildSyntheticTextMessage), so it can look like a user photo. `style` works without richMessages; only width needs it.

## Decision

A button is `{label, value}` with no `action` key. `value` names the action in full, under 64 bytes. A candidate menu with covers is one message per candidate. Media on a `callback_data:` message is ignored. The button that does the thing is styled. AGENTS.md overrules the runtime prompt explicitly.

## Consequences

64-byte ceiling on values. One send per candidate, which races in DMs (README:600-603). The evidence is tied to 2026.7.1-2 and must be re-probed on upgrade. Reopen by trying OpenClaw's `beta` dist-tag; a working callback branch would also lift the 64-byte ceiling.

## Related

- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [agent/skills/gamereg/reference/media.md](../../agent/skills/gamereg/reference/media.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- Dockerfile
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
