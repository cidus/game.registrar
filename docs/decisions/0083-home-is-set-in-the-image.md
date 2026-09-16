# 0083. HOME is set in the image

- **Status:** Accepted
- **Date:** 2026-09-02
- **Area:** Container deployment

## Context

The image declares `USER node` (uid 1000), and compose overrides it with the host's uid so the bind-mounted vault is not owned by a stranger. On the e2-micro that uid was 1001, absent from the container's /etc/passwd. Docker fell back to HOME=/ (root-owned), `git config --global` failed silently, and the vault's first commit aborted. It passed locally only because the development uid is 1000.

## Decision

`ENV HOME=/config` in the Dockerfile, so git's global config and the gateway share one writable place regardless of uid.

Set ENV HOME=/config in the image.

## Consequences

/config holds.gitconfig as well as gateway state. Any service that does not mount /config must set its own HOME (site-build uses HOME=/cache). Never rely on a uid-derived HOME in an image run with `user:` overrides.

## Related

- Dockerfile
- [compose.yml](../../compose.yml)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [.env.example](../../.env.example)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
