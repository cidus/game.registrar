# 0086. Comments are served under the site's origin through a subpath proxy

- **Status:** Accepted
- **Date:** 2026-09-02
- **Area:** Site and comments

## Context

site-serve can front Remark42 at /remark42 (SITE_COMMENTS_UPSTREAM): one port, no CORS. The feared defect, OAuth links losing the prefix (umputun/remark42#961), did not reproduce with a real GitHub login on v1.16.4. An earlier 'cross-origin' last-comments failure was actually `components: ["last"]` requesting a non-existent /web/last.mjs. Neither profile should run on the e2-micro, and a test pins that. The site loop watches git HEAD, not mtimes, and watches rather than being triggered, to avoid the Docker socket.

## Decision

The same-origin subpath proxy is the default; the separate port is a documented escape. The site build is triggered by polling git HEAD. There is never a docker.sock mount.

## Consequences

If a sign-in link ever loses /remark42, publish Remark42 on its own port. The poll interval adds latency (default 300s).

## Related

- [docker/site-loop.sh](../../docker/site-loop.sh)
- [compose.yml](../../compose.yml)
- [.env.example](../../.env.example)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
