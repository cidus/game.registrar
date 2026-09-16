# 0078. One image holds the CLI and the gateway, built from npm pack

- **Status:** Accepted
- **Date:** 2026-09-01
- **Area:** Container deployment

## Context

The agent's boundary requires gamereg as a local binary, and the maintenance sweep needs the same binary, so one image holds CLI and gateway. The image is built from npm pack to exercise the publish path. loop.sh replaces the systemd timer. Overlap needs no guard because of the build lock and git-status-as-state.

Dockerfile L6 says 'two' and is stale too. FALSE, 'exercises... What this leaves untested is `prepare` itself'. STALE list: compose.yml no longer builds.

## Decision

One image carries CLI and gateway at pinned versions and is built from an npm-pack tarball. The container maintenance interval is a plain shell loop.

## Consequences

Several details are now false. The paragraph also predates publishing: compose now pulls a registry image.

## Related

- Dockerfile
- [compose.yml](../../compose.yml)
- [compose.build.yml](../../compose.build.yml)
- [.env.example](../../.env.example)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [docker/loop.sh](../../docker/loop.sh)
- [docker/site-loop.sh](../../docker/site-loop.sh)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
