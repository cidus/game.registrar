# 0097. AGENTS.md stays large and code-owned; customization goes in USER.md

- **Status:** Accepted
- **Date:** 2026-09-13
- **Area:** Agent prompt

## Context

Asked why the card is not updated, the intuitive answer is to make it small and customizable and push the rest elsewhere. But 'elsewhere' is skills/, a read paid per session, while workspace/*.md is compiled into the system prompt and cached: the exact inversion the optimization pass undid when it moved the procedure into the card.

## Decision

The card stays big and becomes code (replaced every boot). What gets its own file is the customization, which is the small part: USER.md holds house rules, which never beat Safety in AGENTS.md.

## Consequences

AGENTS.md occupies the biggest share of the always-loaded budget. USER.md is seeded (user-owned) and empty by default.

## Related

- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [agent/workspace/USER.md](../../agent/workspace/USER.md)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
