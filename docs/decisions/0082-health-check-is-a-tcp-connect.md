# 0082. The gateway health check is a TCP connect

- **Status:** Accepted
- **Date:** 2026-09-02
- **Area:** Container deployment

## Context

The gateway health check was `openclaw gateway health`, a whole Node process: 0.4s on a laptop, minutes on a shared 0.25 vCPU e2-micro under memory pressure, which is longer than the 30s interval. Checks piled up, a dozen Node processes pushed load average past 30, and they starved the boot they were gating. Only a slow machine surfaces this.

Host uid 1001 was absent from the image's /etc/passwd, so Docker fell back to HOME=/, `git config --global` failed silently and the first vault commit aborted; it had passed locally only because the dev uid is 1000. The health check `openclaw gateway health` took 0.4s locally and minutes on the e2-micro, longer than the 30s interval, so checks piled up (load average above 30) and starved the boot they gated.

## Decision

The health check is a bare `bash -c 'exec 3<>/dev/tcp/127.0.0.1/${OPENCLAW_GATEWAY_PORT:-18789}'` connect. It spawns nothing and answers the only question `provision` asks: is the gateway listening. Slow boots are handled with start_period (GATEWAY_START_PERIOD, 300s default), not a longer interval.

Set ENV HOME=/config in the image. The health check is a bare bash /dev/tcp connect that spawns nothing. Rule: a health check that costs more than its interval is an outage generator.

## Consequences

Healthy means listening, not ready for authenticated RPC; provision copes by retrying (restart: on-failure:5). Never put a Node or CLI process in a healthcheck. Tune GATEWAY_START_PERIOD, never the check frequency.

The health check proves listening, not authenticated readiness; provision retries for the rest. Slow machines raise GATEWAY_START_PERIOD, never the check frequency.

## Related

- [compose.yml](../../compose.yml)
- [.env.example](../../.env.example)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- Dockerfile
