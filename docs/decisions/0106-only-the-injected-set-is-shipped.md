# 0106. Only the files OpenClaw injects are shipped as workspace files

- **Status:** Accepted
- **Date:** 2026-09-23
- **Area:** Agent prompt

## Context

[0067](0067-every-workspace-slot-is-shipped.md) reasoned that a workspace slot
is filled either way, so the deployment should choose what fills it — and that
shipping every slot made the prompt budget measure the whole prompt. Both halves
rested on a premise that OpenClaw 2026.9.4 changed and nothing here noticed.

**OpenClaw reads a fixed list of filenames into the system prompt.**
`loadWorkspaceBootstrapFiles` filters `WORKSPACE_BOOTSTRAP_FILENAMES`; there is
no glob over `workspace/*.md`, in either version.

| File | 2026.7.1-2 | 2026.9.4 |
|---|---|---|
| `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md` | injected | injected |
| `BOOTSTRAP.md`, `MEMORY.md` | — | injected when present |
| `TOOLS.md` | **injected** | **dropped** |
| `HEARTBEAT.md` | not injected | not injected |
| `REACTIONS.md` | never — ours, read on demand | never |

So the upgrade on 2026-09-11 silently stopped `TOOLS.md` reaching the model, and
the tool-surface notes it carried were absent from every turn for twelve days.
Nothing failed: a file that is not read produces no error. `HEARTBEAT.md` was
shipped to claim a slot that had already stopped existing — the schema calls it
"accepted but a no-op", and `skipOptionalBootstrapFiles` is the modern way to
refuse a generated file, which makes claiming one unnecessary.

Shipping either also left `openclaw doctor` reporting migrations that can never
complete: it wants `TOOLS.md` merged into the card's Tools section and
`HEARTBEAT.md` moved into cron-owned scratch, and a boot that re-seeds them
undoes the migration every time.

And the budget measured the wrong set. `agent/workspace/*.md` counted
`REACTIONS.md`, `TOOLS.md` and `HEARTBEAT.md` — 3,841 bytes no turn ever saw.
That is the error [0067](0067-every-workspace-slot-is-shipped.md) set out to fix,
pointed the other way: a budget over the wrong set is not a budget either.

## Decision

Ship a workspace file only if OpenClaw injects it, or if the prompt tells the
agent to read it.

`TOOLS.md` and `HEARTBEAT.md` are no longer shipped. `TOOLS.md`'s two facts that
the card did not already carry — the allowlist matches the bare command name, so
it covers every subcommand including `amend` and `revoke`; `exec`, `message` and
`read` are the whole tool surface — are now sentences in `AGENTS.md`'s
*Boundary*, which is where upstream's own migration puts them. The rest of that
file was a pointer to `reference/cli.md` and an explanation of why it existed.

`REACTIONS.md` stays, reclassified rather than removed: it is read with the
`read` tool when a reaction is sent, exactly as a `reference/` file is, and it
was never injected in any version. It is shipped because the agent is told to
read it, not to hold a slot.

The entrypoint moves `TOOLS.md` and `HEARTBEAT.md` out of an existing workspace
alongside `DREAMS.md` — one list, one reason: nothing reads them there. Moved,
never deleted, and their seed hashes are dropped so a later boot does not
re-adopt them.

`test/agent-skill.test.ts` measures the injected list, asserts every shipped
file is classified injected or read-on-demand, and refuses the two by name. It
also asserts OpenClaw's own ceilings — `bootstrapMaxChars` truncates one file at
20,000 characters and `bootstrapTotalMaxChars` the set at 60,000 — because
silent truncation of `AGENTS.md` would cut *Safety*, which is at its end.

## Consequences

The budget falls from 32,000 to 28,000 and now covers 26,408 real bytes across
four files. It will move again when OpenClaw's list moves, which is the
maintenance this buys: **the list is upstream's, and a version bump can change
it without failing anything.** The test names the two files upstream dropped, so
re-adding either fails in CI; it cannot notice a *new* name upstream starts
injecting. Re-read `WORKSPACE_BOOTSTRAP_FILENAMES` on an OpenClaw upgrade — the
same habit the check-in config key earned on the same upgrade.

Reversing [0067](0067-every-workspace-slot-is-shipped.md)'s conclusion does not
reverse its observation: OpenClaw did seed a generic `TOOLS.md` within the hour
in 2026.7.1-2, and that was true. The lesson is narrower than "claim the slot" —
a slot worth claiming is one the gateway will fill, and whether it will is a
fact about the installed version, not a property of the workspace.

## Related

- [0067](0067-every-workspace-slot-is-shipped.md) — superseded by this
- [0064](0064-boundaries-by-tools-allow.md) — the tool surface those sentences describe
- [0098](0098-dreaming-disabled.md) — `DREAMS.md`, retired for the same reason
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [agent/workspace/REACTIONS.md](../../agent/workspace/REACTIONS.md)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
