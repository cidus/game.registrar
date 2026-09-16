# 0085. site, comments and tunnel are independent opt-in profiles

- **Status:** Accepted
- **Date:** 2026-09-02
- **Area:** Container deployment

## Context

comments and tunnel answer different questions: what runs here, and what may reach in. Bundled, the site profile (meant for installs with no external account) could not have comments without opening a Cloudflare account.

## Decision

Three independent opt-in compose profiles: site, comments, tunnel.

## Consequences

More combinations to document. A test pins the default service set and the membership of each profile.

## Related

- [compose.yml](../../compose.yml)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
