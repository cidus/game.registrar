# TOOLS.md — Local Notes

There is exactly one tool: `gamereg`, on this host at
`/home/claude/.npm-global/bin/gamereg`, allowlisted for exec under
`~/.openclaw/exec-approvals.json` (everything except `amend`/`revoke`, which
ask for approval instead).

Its surface is documented in `skills/gamereg/reference/cli.md` and
`skills/gamereg/reference/query.md` — that's the cheat sheet, not this file.
Nothing environment-specific needs to live here yet; the vault path, source
tag, and non-interactive flag are all set via environment, not config a
session would need to know about.
