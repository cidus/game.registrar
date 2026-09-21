# 0092. OpenClaw is pinned to 2026.9.4 on Node 24, with a 1g memory floor

- **Status:** Accepted
- **Date:** 2026-09-11
- **Area:** Container deployment

## Context

Measured idle, same config: OpenClaw 2026.7.1-2 on Node 22 is 275 MB, the same on Node 24 is 377 MB, 2026.9.4 on Node 24 is 432 MB (+157 MB). 2026.9.4 requires Node >=24.16, so pinning OpenClaw alone does not recover it. Nothing turns it down: plugins.allow does not reduce the loaded set (30 of 59 stay enabled with three allowed, unlike tools.allow), and capping the V8 heap buys ~10 MB before the process stops starting, so the growth is native baseline, not heap. At 480m the gateway idles at 90% and restarts itself every ~73 seconds under its own memory-pressure check, which looks healthy because every boot passes the health check before dying. npm audit: 11 known advisories against 2026.7.1-2 (7 high) and none against 2026.9.4 (SSRF/trust-boundary in fast-uri and ip-address, DoS in brace-expansion, ten moderates in hono), all transitive. Reachability is low (no published gateway port, no web tools under tools.allow, one allowlisted sender), but not none, and the upgrade already cost three migrations.

## Decision

Take the upgrade. GATEWAY_MEM_LIMIT defaults to 1g as a floor. The 1 GB e2-micro is no longer a comfortable target, and docs/deploy-container.md says so. A deployment that genuinely needs 1 GB should pin the old version deliberately, knowing what it accepts, rather than drift into it.

Take OpenClaw 2026.9.4 on Node 24. GATEWAY_MEM_LIMIT defaults to 1g, and that is a floor.

## Consequences

Recommended RAM is now 1.5 GB plus required swap (1 GB 'only with care'). Some comments are stale against these numbers: compose.yml:141 and test/entrypoint-wrapper.test.ts:714 say 'a gateway already holding 250-400' MB (now ~432); compose.yml:149-150 says the image is 'built on node:22-bookworm-slim' while Dockerfile:16 is 24-bookworm-slim; compose.yml:7-9 still says it is sized for an e2-micro.

The 1 GB e2-micro is no longer comfortable and swap is required. Pinning 2026.7.1-2 is not a one-line change: it needs a local build (OPENCLAW_VERSION is a Dockerfile ARG, so compose.build.yml), and `tools.exec.mode` must revert to `security` plus `ask` because 2026.7.1-2 rejects `mode` (openclaw.example.json5:250-253). The entrypoint's upgrade repairs (doctor --fix, approvals set, legacy file removal) assume 2026.9 stores.

## Related

- Dockerfile
- [compose.yml](../../compose.yml)
- [.env.example](../../.env.example)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- [agent/README.md](../../agent/README.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [CHANGELOG.md](../../CHANGELOG.md)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- git show main:CHANGELOG.md [Unreleased] Changed (8d8ed2e): tools.exec.security+ask migrated to tools.exec.mode "allowlist"; exec allowlist seeded with `openclaw approvals set` because the store moved into state/openclaw.sqlite (ask the installed CLI to write its own store, never copy its file); `openclaw doctor --fix` repairs a stale config (meta.lastTouchedAt) before anything reads it
- commit 0fdccf3: $STATE_DIR/.gateway-token is the authority and is restated into gateway.auth.token every boot (token_mismatch)
- git show main:agent/README.md Traps "The container will not boot after an OpenClaw upgrade" and "Every CLI client gets token_mismatch"
