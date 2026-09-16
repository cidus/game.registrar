# 0023. Only closing a run fills a missing platform; enrich never writes one

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Platforms

## Context

start records only what it knows, so a run can reach end/finish/drop with no platform. By then the game is usually enriched and the catalog can narrow the question.

## Decision

end, finish and drop settle a missing platform: the --platform flag, else the sole catalog/vault intersection, else an interactive prompt, else null. The result is recorded as event.amend on the run's run.open/run.import. enrich reads run platforms and never writes one. Ambiguity leaves null and the close still happens.

## Consequences

A closed run may have a null platform, which is a fact, not an error. An inferred platform is stated aloud (prose.platform.inferred). Typed platforms join config.platforms.

## Related

- [src/cli/platform.ts](../../src/cli/platform.ts)
- [src/cli/close-run.ts](../../src/cli/close-run.ts)
- [src/cli/commands/end.ts](../../src/cli/commands/end.ts)
- [src/cli/commands/finish.ts](../../src/cli/commands/finish.ts)
- [src/cli/commands/drop.ts](../../src/cli/commands/drop.ts)
- [src/cli/commands/enrich.ts](../../src/cli/commands/enrich.ts)
