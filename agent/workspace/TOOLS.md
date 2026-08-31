# TOOLS.md — Local Notes

There is one tool: `gamereg`, on `PATH`, allowlisted for exec under
`~/.openclaw/exec-approvals.json`. The allowlist matches the bare command name,
so it covers every subcommand — `amend` and `revoke` included, whose
confirmation is the conversational one in `AGENTS.md`, not an approval prompt.

The gateway's own tool surface is cut to `exec`, `message` and `read` by
`tools.allow` (`agent/openclaw.example.json5`). Nothing else is reachable, so
nothing else needs describing here.

Its surface is documented in `skills/gamereg/reference/cli.md`, and the SQL
schema in `reference/query.md`. That is the cheat sheet, not this file.

**This file exists to hold the slot.** Deleting it does not stick: OpenClaw
seeds its own generic `TOOLS.md` — camera names, SSH hosts, TTS voices — into
the workspace, and that boilerplate then sits in the system prompt on every
turn describing capabilities this deployment does not have. Confirmed live: the
default reappeared within an hour of being removed. A short, true file is
cheaper than the default and cannot be mistaken for instructions.

Do not write an absolute path here. This file gets copied into a deployment,
and a path naming one host's home directory is wrong on the next one. The vault
path, source tag and non-interactive flag are all set via environment.
