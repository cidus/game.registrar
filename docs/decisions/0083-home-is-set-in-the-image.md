# 0083. HOME is set in the image

- **Status:** Accepted
- **Date:** 2026-09-02
- **Area:** Container deployment

## Context

The image declares `USER node` (uid 1000), and compose overrides it with the host's uid so the bind-mounted vault is not owned by a stranger. On the e2-micro that uid was 1001, absent from the container's /etc/passwd. Docker fell back to HOME=/ (root-owned), `git config --global` failed silently, and the vault's first commit aborted. It passed locally only because the development uid is 1000.

Host uid 1001 was absent from the image's /etc/passwd, so Docker fell back to HOME=/, `git config --global` failed silently and the first vault commit aborted; it had passed locally only because the dev uid is 1000. The health check `openclaw gateway health` took 0.4s locally and minutes on the e2-micro, longer than the 30s interval, so checks piled up (load average above 30) and starved the boot they gated.

## Decision

`ENV HOME=/config` in the Dockerfile, so git's global config and the gateway share one writable place regardless of uid.

Set ENV HOME=/config in the image. The health check is a bare bash /dev/tcp connect that spawns nothing. Rule: a health check that costs more than its interval is an outage generator.

## Consequences

/config holds.gitconfig as well as gateway state. Any service that does not mount /config must set its own HOME (site-build uses HOME=/cache). Never rely on a uid-derived HOME in an image run with `user:` overrides.

The health check proves listening, not authenticated readiness; provision retries for the rest. Slow machines raise GATEWAY_START_PERIOD, never the check frequency.

## Related

- Dockerfile
- [compose.yml](../../compose.yml)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [.env.example](../../.env.example)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
