# REACTIONS.md — Sticker Mapping

The five reaction tokens and what this installation resolves them to. The
tokens are fixed and closed (`docs/spec/05-agent.md`, *Reactions*); the assets
are yours, and they are the only thing in this file you edit.

**No sticker ships, and none will.** The sticker column below is empty for
every row and stays that way in this repository — a Telegram `file_id` belongs
to one bot and would be wrong on the next install. The emoji column ships with
a default set, since an emoji is not an asset: nothing to obtain, nothing
installation-specific, and a register that reacts with a plain emoji is a
reasonable thing to want out of the box. Replace any of them freely; deleting
one back to empty is just as valid.

## The table

| Token | Sticker (Telegram `file_id`) | Emoji |
|---|---|---|
| `filed` | | 🗂️ |
| `approved` | | ✅ |
| `archived` | | 🗃️ |
| `pending` | | ⏳ |
| `puzzled` | | 🤔 |

Read the row for the token, left to right, and take the first cell that has a
value: send the sticker, else add the emoji reaction, else do nothing. An empty
row is a decision, not an omission.

Do not add rows. A sixth token is a change to the spec and to
`skills/gamereg/SKILL.md`, not a change to this file.

## Filling in the sticker column

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
