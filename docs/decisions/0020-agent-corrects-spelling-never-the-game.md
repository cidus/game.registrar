# 0020. The agent corrects how a title is written, never which game is meant

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Agent prompt

## Context

'Super Mario' names a family, not one game. `search` asks the provider only when the local result is empty, so once a guessed title exists locally the provider is never asked again and the wrong game sticks.

## Decision

The agent corrects how a title was written (spelling, casing; enrich fixes the stored title later) but never decides which game was meant. It searches with the user's literal words. Several candidates, even at exit 0, are the same question exit code 3 asks.

## Consequences

Family names cost an extra question, which prevents a locally created guess from masking the catalog.

## Related

- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [src/cli/commands/search.ts](../../src/cli/commands/search.ts)
- [agent/skills/gamereg/reference/cli.md](../../agent/skills/gamereg/reference/cli.md)
- docs/spec/05-agent.md:140-146
