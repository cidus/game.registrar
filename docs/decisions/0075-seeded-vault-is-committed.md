# 0075. A freshly seeded vault is committed at creation

- **Status:** Accepted
- **Date:** 2026-09-01
- **Area:** Container deployment

## Context

autobuild.sh treats 'the tree is dirty' as its entire state and only ever stages the event log, assets, mirrored assets and build-planned paths, never gamereg.config.json or.gitignore. An uncommitted seed makes every tick, forever, run an enrichment that reaches the network plus a build with nothing to do. On a host a person commits those without thinking; in a container nobody does.

Seventh: a freshly seeded vault must be committed or autobuild enriches over the network every tick forever.

## Decision

When the entrypoint initialises an empty vault and creates its git repository, it runs `git add -A` and commits 'chore(vault): initial commit'.

The seed vault is committed at creation.

## Consequences

This only happens when the vault had no.git (entrypoint.sh:159). A vault that is already a git repository with an uncommitted gamereg.config.json is not fixed and will spin. No test asserts the commit: test/entrypoint-wrapper.test.ts:187-198 checks only that the config and.git exist.

## Related

- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [scripts/autobuild.sh](../../scripts/autobuild.sh)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [compose.yml](../../compose.yml)
