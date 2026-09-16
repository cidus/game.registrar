# The agent layer

Optional. The CLI works without it and nothing in `src/` depends on it.

[docs/spec/05-agent.md](../docs/spec/05-agent.md) is the specification; this
directory is one implementation of it for [OpenClaw](https://openclaw.ai). Any
gateway that can execute a command would do.

- To set one up: [Chat agent](../docs/guides/chat-agent.md), then
  [Deploy with containers](../docs/guides/deploy-container.md) (recommended) or
  [Deploy on a host](../docs/guides/deploy-host.md).
- Why it is shaped this way:
  [The agent layer](../docs/explanation/agent-design.md) and the
  [decision records](../docs/decisions/README.md).
- When something misbehaves:
  [Troubleshooting](../docs/guides/troubleshooting.md).

## What the agent is allowed to be

It turns a message into a `gamereg` invocation and relays the result. It does
not read or write vault files, does not compute durations, and does not invent
identifiers. Every number it reports comes from the database.

## Contents

```
workspace/              copied into the gateway's workspace; compiled into the
                        system prompt on every turn
  AGENTS.md             the operating card: boundary, procedure, buttons, safety
  SOUL.md               the persona's voice
  IDENTITY.md           name, creature, vibe
  REACTIONS.md          the per-installation token mapping
  USER.md               your own house rules
  HEARTBEAT.md          what to do when woken by a finished background call
  TOOLS.md              holds the slot the gateway would otherwise fill itself
skills/gamereg/         read on demand, mid-turn
  SKILL.md              a pointer back to the card
  reference/cli.md      the CLI surface, kept honest by test/agent-skill.test.ts
  reference/query.md    the SQL schema and how to answer questions with it
  reference/media.md    candidate menus, photos, covers, reactions
  reference/corrections.md   amend, revoke, undoing a mistake
  reference/checkins.md the check-in wake and its three exits
openclaw.example.json5  channel, tool allowlist, voice transcription
approvals.example.json  which commands the agent may run unattended
checkin.sh              the hourly check-in poll: CLI only, no model
PERSONAS.md             how the two clerks are drawn. Design material, deployed
                        nowhere and read by nobody at runtime
```

## How each file is deployed

| File | In the container | On a host |
|---|---|---|
| `skills/gamereg/**` | Replaced on every boot | `cp -R` after every update |
| `AGENTS.md`, `TOOLS.md` | Replaced on every boot | `cp` after every update |
| `SOUL.md`, `IDENTITY.md`, `REACTIONS.md`, `USER.md`, `HEARTBEAT.md` | Seeded once, then yours; the boot records a hash so an untouched file still follows the image | `cp` once |
| `openclaw.example.json5` | Seeded once, with an environment overlay every boot | `openclaw config patch` |
| `approvals.example.json` | Written through the gateway's own CLI at boot | `openclaw approvals set` |
| `checkin.sh` | Installed as `gamereg-checkin`, registered by the `provision` service | `cp` plus `openclaw cron add` |
| `PERSONAS.md` | Not deployed | Not deployed |

The container's per-file policy, and how it tells an edit from a shipped
default that moved, is in
[Container reference](../docs/reference/container.md#agent-files).

## Editing the prompt

`AGENTS.md` and `TOOLS.md` are **code**: their contents are asserted against
the real binary and the real SQL schema by
[`test/agent-skill.test.ts`](../test/agent-skill.test.ts), which also holds a
size budget over `workspace/*.md`. Rules that shaped these files, and that a
change should respect:

- The common procedure belongs in the always-loaded card; rare flows belong in
  `reference/` files that are read only when that flow happens
  ([ADR 0063](../docs/decisions/0063-procedure-in-the-always-loaded-card.md)).
- A boundary is enforced with the tool allowlist, not with prose
  ([ADR 0064](../docs/decisions/0064-boundaries-by-tools-allow.md)).
- These files state rules; the incident that produced a rule belongs in the
  decision record
  ([ADR 0070](../docs/decisions/0070-prompt-states-rules-not-incidents.md)).
- They address the model, so they cite no repository path
  ([ADR 0071](../docs/decisions/0071-prompt-cites-no-repository-paths.md)).
- Examples are whole tool calls, never fragments
  ([ADR 0069](../docs/decisions/0069-prompt-examples-are-whole-calls.md)).
- They are written in English, with no phrasebook: the words the agent says
  come from `gamereg vocab`
  ([ADR 0019](../docs/decisions/0019-agent-gets-words-not-sentences.md)).
- Customization goes in `USER.md`, which never overrides the *Safety* section
  of `AGENTS.md` ([ADR 0097](../docs/decisions/0097-agents-md-is-code.md)).

## What is not here

**No sticker artwork, and none is coming.** The reaction tokens are wired end
to end and every sticker cell in `REACTIONS.md` is empty, which is the finished
state for this repository: a `file_id` belongs to a bot, so the table cannot be
shared.

**No second persona.** Gaby exists only inside `workspace/SOUL.md` and
`PERSONAS.md`; her counter stays closed until board games land, so the fiction
and the roadmap say the same thing.
