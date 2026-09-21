# 0045. Reaction tokens are identifiers and are never translated

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Agent prompt

## Context

Four tokens (filed, approved, archived, pending) collide by name with the persona's localized vocabulary, which is prose served by `gamereg vocab`. A translated token matches no row and the reaction silently does not happen, which looks exactly like a correct empty installation.

## Decision

Tokens (filed, approved, archived, pending, puzzled) are identifiers: never translated, never shown to the user, never passed to gamereg. The warning is repeated in every place the tokens are written down rather than once.

## Consequences

Deliberate redundancy across the docs. A test keeps the token list consistent between the skill reference and REACTIONS.md.

## Related

- [docs/spec/05-agent.md](../spec/05-agent.md)
- [agent/skills/gamereg/reference/media.md](../../agent/skills/gamereg/reference/media.md)
- [agent/README.md](../../agent/README.md)
- [agent/workspace/REACTIONS.md](../../agent/workspace/REACTIONS.md)
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
