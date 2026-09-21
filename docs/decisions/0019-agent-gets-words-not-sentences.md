# 0019. The agent gets vocabulary from the CLI, never localized sentences

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Agent prompt

## Context

JSON output is neutral by contract, so every word the user reads in chat is one the model chose. Without help it invents translations of enum tokens and register terms, inconsistently and often in English.

## Decision

`gamereg vocab` hands the agent words, never sentence templates it could fill in and fabricate: outcomes, statuses, the register's own acts, and entity nouns (game/run/session/break/verdict). i18n/ stays the one place a term is written down. No glossary in the agent layer, no per-language skill.

## Consequences

test/vocab.test.ts enforces no placeholders ({ or }), no padding or empty terms, the same term set in every locale, and a term for every enum token. A per-locale reference file would be a copy that drifts.

## Related

- [src/cli/commands/vocab.ts](../../src/cli/commands/vocab.ts)
- [src/i18n/index.ts](../../src/i18n/index.ts)
- [test/vocab.test.ts](../../test/vocab.test.ts)
- [agent/checkin.sh](../../agent/checkin.sh)
- docs/spec/05-agent.md:55-100 (Language: observed failures)
- CLAUDE.md "## Language" (the agent keeps no glossary)
