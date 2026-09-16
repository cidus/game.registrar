# 0075. A freshly seeded vault is committed at creation

- **Status:** Accepted
- **Date:** 2026-09-01
- **Area:** Container deployment

## Context

autobuild.sh treats 'the tree is dirty' as its entire state and only ever stages the event log, assets, mirrored assets and build-planned paths, never gamereg.config.json or.gitignore. An uncommitted seed makes every tick, forever, run an enrichment that reaches the network plus a build with nothing to do. On a host a person commits those without thinking; in a container nobody does.

Four gateway start failures with misleading messages: no gateway.mode in config; the container bind switching to 0.0.0.0 and demanding auth; `gateway health` exiting 1 without a token, which would have left provision waiting forever; `openclaw onboard` being the only owner of the model credential. Two Compose issues: ${VAR:?} in an opt-in profile breaks every command; provision needs network_mode service:gateway because plaintext ws:// to a non-loopback address is refused. Seventh: a freshly seeded vault must be committed or autobuild enriches over the network every tick forever.

## Decision

When the entrypoint initialises an empty vault and creates its git repository, it runs `git add -A` and commits 'chore(vault): initial commit'.

The entrypoint writes gateway.mode local and generates /config/.gateway-token. No required-variable syntax in compose. provision shares the gateway's loopback. The seed vault is committed at creation.

## Consequences

This only happens when the vault had no.git (entrypoint.sh:159). A vault that is already a git repository with an uncommitted gamereg.config.json is not fixed and will spin. No test asserts the commit: test/entrypoint-wrapper.test.ts:187-198 checks only that the config and.git exist.

Each Compose finding is a test. The health-token fix was later replaced by a bare TCP health check.

## Related

- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [scripts/autobuild.sh](../../scripts/autobuild.sh)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [compose.yml](../../compose.yml)
