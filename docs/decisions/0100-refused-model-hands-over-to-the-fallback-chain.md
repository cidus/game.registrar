# 0100. A model that refuses hands over to the fallback chain instead of being retried

- **Status:** Accepted
- **Date:** 2026-09-16
- **Area:** Container deployment

## Context

OpenRouter was configured as the fallback, credentialed, and never once asked.
Every rate limit reached the user as "this turn was interrupted because it
stopped making progress", which names neither the limit nor the model.

OpenClaw 2026.9.4 retries the *same* model before it will consider the fallback
chain, and on a 429 it sleeps for the provider's `Retry-After`. Anthropic
answers a subscription limit with however long the limit has left: 41 to 260
minutes across five logged incidents, while the turn is abandoned after about
six. Two upstream details make it a bug rather than a preference. The delay is
`Math.max(jittered, retryAfterMs)`, where only the jitter is capped, so the
header walks straight past the 30-second ceiling. And the 90-second total retry
budget is disabled precisely for `rate_limit`, by passing `elapsedMs` as
undefined — the one case the ceiling existed for. A subsystem whose own
constants say 90 seconds slept for 74 minutes. The escape hatch that does exist,
a "long window" classifier, reads the error *text* for
`daily|weekly|monthly|usage limit|subscription|quota`; Anthropic's message is
generic, so it never fires.

The first suspicion was the auth store — the trap already recorded in
[0081](0081-credentials-in-the-auth-store.md), since the store holds only the
Anthropic credential. It was wrong: `openclaw models status` reports OpenRouter
as `effective: {kind: "env"}`, so for that provider the environment genuinely is
an auth path.

## Decision

The entrypoint writes `retry.provider.maxRetries: 0` into the agent's
`settings.json` (`OPENCLAW_PROVIDER_MAX_RETRIES` changes it), so a refusal
hands over to the chain instead of waiting. `OPENCLAW_MODEL_FALLBACK` takes a
comma-separated chain, tried in order.

## Consequences

There is no per-provider retry setting: `settings.retry.provider` names the
layer, not the vendor, and `getProviderRetrySettings()` takes no provider
argument. Turning the budget off therefore turns it off for OpenRouter too,
losing a short same-model retry that a 529 genuinely wants. Depth in the chain is
the substitute — another entry does what a retry did, without waiting on the
model that just refused. Do not keep hunting for a per-provider knob; it is not
there.

Raising `OPENCLAW_PROVIDER_MAX_RETRIES` is worth doing only with no fallback
configured, where waiting is all there is to do.

`openclaw models status` is the one-line answer to whether a credential is
usable, and is worth running before suspecting retries.

## Related

- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [.env.example](../../.env.example)
- [docs/reference/container.md](../reference/container.md#boot-sequence)
- [docs/guides/troubleshooting.md](../guides/troubleshooting.md)
- [0092](0092-openclaw-pinned-with-1g-floor.md) — the pinned gateway version this describes
