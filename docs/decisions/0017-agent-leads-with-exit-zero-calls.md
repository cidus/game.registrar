# 0017. CLI exit codes stay; the agent leads with calls that exit 0

- **Status:** Accepted
- **Date:** 2026-08-19
- **Area:** Agent prompt

## Context

OpenClaw shows a failed-exec warning in chat for any non-zero exit (README:322-324). In gamereg, codes 3 (ambiguous) and 4 (not_found) are ordinary answers (02-cli.md:66-67), so a flow that works as designed still puts a warning on the user's screen. `start` does no network I/O, so the first session of a new game exits 4 before the catalog is consulted.

## Decision

No change to the CLI: the exit codes are the contract (02-cli.md:63-70), and returning 0 for not-found would be worse for every other caller. The prompt avoids the collision instead: when a game may be new, the agent leads with `search`, which exits 0 whether it finds nothing, a local hit or a provider hit.

## Consequences

Warnings still appear for real errors and for any code 3/4 the agent does reach. Do not make not_found or ambiguous return 0. Reopen if the gateway can suppress the warning per exit code.

## Related

- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [src/cli/commands/search.ts](../../src/cli/commands/search.ts)
- [docs/spec/02-cli.md](../spec/02-cli.md)
