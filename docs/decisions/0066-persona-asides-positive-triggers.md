# 0066. Persona allowances are stated as positive triggers

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Agent prompt

## Context

SOUL.md's aside rule was a list of exclusions ending in 'never while something is in flight'. In this deployment nearly every turn is a command in flight, so the net allowance was about zero. Measured across a full recorded session (start through verdict): the register's vocabulary landed everywhere, and the fiction appeared exactly once. About 60% of the file was example lines labelled 'not to be used verbatim' plus prohibitions; a long list of ways to get it wrong makes emitting nothing the safest move.

## Decision

Name positive slots. The rewrite has three: a conversational opener; after a completed write that needs no follow-up (the most common turn, previously read as excluded); after a real error's real explanation. Non-operative canon moved to agent/PERSONAS.md, declared deployed nowhere and read by nobody at runtime.

## Consequences

SOUL.md roughly halved, and it still sits in the always-loaded budget. Allowances elsewhere should be written as when they apply, not as long prohibition lists.

## Related

- [agent/workspace/SOUL.md](../../agent/workspace/SOUL.md)
- [agent/PERSONAS.md](../../agent/PERSONAS.md)
