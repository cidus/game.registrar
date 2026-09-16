# 0090. The query guard refuses the reserved pragma_ and sqlite_ namespaces

- **Status:** Accepted
- **Date:** 2026-09-04
- **Area:** Security

## Context

Four latent findings. The guard's pragma_ gap. site-build mounting the vault writable while executing third-party Quartz plugin code. Unescaped values interpolated into the gateway's JSON5 patches, where a quote adds configuration. `provision --dry-run` contacting the gateway via `cron list`.

## Decision

Refuse the pragma_ and sqlite_ namespaces. Stage the Quartz build in a scratch dir with /vault:ro. json_escape every interpolated value. Dry-run performs no network read. Embedded rule: an undocumented exception to a stated boundary is one somebody leans on.

## Consequences

History plus one reusable rule. The fixes are covered by code comments and tests.

## Related

- [src/db/guard.ts](../../src/db/guard.ts)
- [test/guard.test.ts](../../test/guard.test.ts)
- [compose.yml](../../compose.yml)
- [docker/site-loop.sh](../../docker/site-loop.sh)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- git show main:CHANGELOG.md [Unreleased] Fixed (ac65c33)
- src/db/ query guard and test/guard.test.ts
