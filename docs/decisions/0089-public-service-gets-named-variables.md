# 0089. The public-facing service receives its environment variables by name

- **Status:** Accepted
- **Date:** 2026-09-04
- **Area:** Security

## Context

`remark42` carried `env_file: [.env]` so the AUTH_* variables would reach it. They did, along with the model credential, the Telegram bot token, the tunnel token and the IGDB keys, none of which Remark42 reads; confirmed by `docker inspect` on the running container. The fix then introduced its own bug: `AUTH_TELEGRAM: ""` is not equivalent to omitting it, because Remark42 treats a variable's presence as enabled. It advertised a sign-in method and failed against the Telegram API with an empty token.

Confirmed by docker inspect.

## Decision

The internet-facing service (remark42) has no env_file; every variable it needs is named in `environment:`. Boolean flags default to an explicit `false`, never empty. The tunnel token moved from argv to the environment.

env_file is a grant of the whole file.

## Consequences

Adding an auth provider needs a line in compose.yml as well as.env, and a test holds the two files together. The gamereg services still use `env_file: [.env]` via the image anchor.

## Related

- [compose.yml](../../compose.yml)
- [.env.example](../../.env.example)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- [CHANGELOG.md](../../CHANGELOG.md)
- git show main:CHANGELOG.md [Unreleased] Fixed (6365022): Patreon and Microsoft were offered in .env.example and never wired; every provider is now named in compose.yml and held to it by a test
- AUTH_TELEGRAM="" read as enabled: boolean flags carry an explicit false
