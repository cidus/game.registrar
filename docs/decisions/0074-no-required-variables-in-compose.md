# 0074. compose.yml uses no required-variable interpolation

- **Status:** Accepted
- **Date:** 2026-09-01
- **Area:** Container deployment

## Context

Compose interpolates the whole file before filtering by profile. One required variable in a service nobody enabled therefore breaks `up`, `config` and every other command for all users. It reads like the more helpful error message and is the opposite.

Four gateway start failures with misleading messages: no gateway.mode in config; the container bind switching to 0.0.0.0 and demanding auth; `gateway health` exiting 1 without a token, which would have left provision waiting forever; `openclaw onboard` being the only owner of the model credential. Two Compose issues: ${VAR:?} in an opt-in profile breaks every command; provision needs network_mode service:gateway because plaintext ws:// to a non-loopback address is refused. Seventh: a freshly seeded vault must be committed or autobuild enriches over the network every tick forever.

## Decision

No `${VAR:?}` anywhere in compose.yml. Opt-in services use empty defaults (`${VAR:-}`) and report their own missing configuration at start.

The entrypoint writes gateway.mode local and generates /config/.gateway-token. No required-variable syntax in compose. provision shares the gateway's loopback. The seed vault is committed at creation.

## Consequences

Errors arrive late and only inside the service that needs the value (Remark42 complains at start), which reaches only whoever enabled that profile. A test enforces the rule.

Each Compose finding is a test. The health-token fix was later replaced by a bare TCP health check.

## Related

- [compose.yml](../../compose.yml)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [scripts/autobuild.sh](../../scripts/autobuild.sh)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
