# 0070. Prompt files state rules; incidents are recorded elsewhere

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Documentation

## Context

Three consecutive live bug fixes each added a paragraph of 'seen live: ...' narrative to the always-loaded card, which went from 10,999 to 13,616 bytes, giving back a third of what cutting SOUL.md had saved. No single addition was wrong; it is the same mechanism that grew SKILL.md to 56KB, invisible per commit and obvious only in aggregate. The story of how a rule was found is worth keeping, but it belongs in the deployment log, which people read and models do not.

## Decision

Two mechanisms: (1) test/agent-skill.test.ts asserts the total size of agent/workspace/*.md, so the ceiling is a number in a diff; (2) the routing table lives in the card (free) rather than SKILL.md (costs a read), leaving SKILL.md at 865 bytes and unread in the common case. When the budget test fails, ask in order: what comes out; does it belong in a reference/ file; only then should the number move.

## Consequences

The budget was raised once, 30,000 to 32,000, deliberately and with the reason in a comment. The rule's direction has since drifted in the docs themselves: the agent deployment notes now says 'The story of how each was found is in the project's working notes', while this rule says incidents go to. the project's working notes itself carries most incident narratives, which is the problem the planned restructure targets. The 865-byte figure is stale (SKILL.md is now 734 bytes).

## Related

- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
- agent/workspace
- [agent/skills/gamereg/SKILL.md](../../agent/skills/gamereg/SKILL.md)
- [agent/README.md](../../agent/README.md)
