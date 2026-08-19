# TOOLS.md — Local Notes

There is exactly one tool: `gamereg`, on `PATH`, allowlisted for exec under
`~/.openclaw/exec-approvals.json`. The allowlist matches the bare command name,
so it covers every subcommand — `amend` and `revoke` included. Their
confirmation is the conversational one in `SKILL.md`, not an approval prompt;
see `agent/README.md` for why that trade was made.

Do not write an absolute path here. This file gets copied into a deployment,
and a path that names one host's home directory is wrong on the next one and
silently wrong on the same one after a move.

Its surface is documented in `skills/gamereg/reference/cli.md` and
`skills/gamereg/reference/query.md` — that's the cheat sheet, not this file.
Nothing environment-specific needs to live here yet; the vault path, source
tag, and non-interactive flag are all set via environment, not config a
session would need to know about.
