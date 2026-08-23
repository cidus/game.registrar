# REACTIONS.md — Sticker Mapping

The five reaction tokens and what this installation resolves them to. The
tokens are fixed and closed (`docs/spec/05-agent.md`, *Reactions*); the assets
are yours, and they are the only thing in this file you edit.

**Ships empty on purpose.** Every row below is unmapped, so the Registrar
reacts with nothing at all until someone fills one in. That is a working
configuration, not a missing step — a register that never stickers anything is
exactly as correct as one that does.

## The table

| Token | Sticker (Telegram `file_id`) | Emoji |
|---|---|---|
| `filed` | | |
| `approved` | | |
| `archived` | | |
| `pending` | | |
| `puzzled` | | |

Read the row for the token, left to right, and take the first cell that has a
value: send the sticker, else add the emoji reaction, else do nothing. An empty
row is a decision, not an omission.

Do not add rows. A sixth token is a change to the spec and to
`skills/gamereg/SKILL.md`, not a change to this file.

## Filling it in

A Telegram `file_id` is not something to look up in a sticker pack's page — it
comes back from the API when a sticker passes through the bot. Send the sticker
to the bot from your own account and read the `file_id` off the update it
receives. Note that a `file_id` is issued *per bot*: the same sticker gets a
different id under a different bot token, so this table does not survive a bot
change.

Two gateway switches have to be on before any of this reaches a chat, and both
are off by default — `channels.telegram.actions.sticker` for the sticker path,
`channels.telegram.actions.reactions` plus a `reactionLevel` above `off` for the
emoji path. `agent/openclaw.example.json5` in the gamereg repository carries
both with their reasoning. With the switches off, a filled table still produces
nothing; the failure is silent by design, because a reaction that did not arrive
is not a problem worth a sentence.
