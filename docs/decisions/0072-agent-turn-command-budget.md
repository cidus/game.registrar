# 0072. An agent turn takes one or two commands

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Agent prompt

## Context

A turn that maps one sentence to one command is cheap, predictable and easy to audit. A turn that fans out is the model exploring, and exploration against a register is how wrong records get written. Observed live: a check-in wake whose facts had moved on — the session it named had already been closed — produced twenty-five commands as the agent tried to work out what had happened.

## Decision

A turn takes one or two `gamereg` calls. Reading before writing is expected (`search`, then `start --id`). When the facts a turn was started with no longer hold, the agent says so and asks, rather than investigating.

## Consequences

A turn that seems to need more calls is evidence that a command is missing, not that the budget is wrong: that is how `open` gained the check-in id and the correctable event ids.

The budget is stated in the always-loaded card, because it applies to every flow.

## Related

- docs/spec/05-agent.md:21-45 ("How many commands a turn takes")
- docs/spec/05-agent.md:386-404 (stale wake facts; twenty-five commands)
