# 0081. Model credentials go into the gateway's auth store; model choice is a separate step

- **Status:** Accepted
- **Date:** 2026-09-02
- **Area:** Container deployment

## Context

Copying CLAUDE_CODE_OAUTH_TOKEN from a working host's.env and writing an `anthropic: cli` profile into the config looks like configuration but authenticates nothing. The credential lives in a per-agent SQLite auth store; the variable is merely what an onboarded host also has. The gateway starts clean and fails at the first message. It took two deployments and a third machine to find. Separately, model choice had been a side effect of whichever auth branch ran, so a host with an OpenRouter key could not select Anthropic without a hand edit.

## Decision

At boot the entrypoint pipes the token on stdin into `openclaw models auth paste-token --provider anthropic`, which needs no running gateway. API keys go through `openclaw onboard --non-interactive --accept-risk... --skip-bootstrap`. Model selection is its own step (OPENCLAW_MODEL, OPENCLAW_MODEL_FALLBACK), patched on every boot.

## Consequences

The auth step is guarded by the /config/.gamereg-auth-seeded sentinel and runs once, so a rotated or replaced token in.env is not re-applied on later boots. Token expiry defaults to 365d (OPENCLAW_AUTH_EXPIRES_IN). With OPENCLAW_MODEL empty, the model is inferred: anthropic/claude-sonnet-5 for Anthropic, openrouter/auto for OpenRouter. Never treat an environment variable as proof a credential is installed.

## Related

- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [.env.example](../../.env.example)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- [docker/site-loop.sh](../../docker/site-loop.sh)
