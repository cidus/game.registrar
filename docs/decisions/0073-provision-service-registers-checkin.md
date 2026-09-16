# 0073. A one-shot provision service registers the check-in job

- **Status:** Accepted
- **Date:** 2026-09-01
- **Area:** Container deployment

## Context

The image places checkin.sh at /usr/local/bin/gamereg-checkin, and a one-shot `provision` service registers it. Registration could not live in the boot script: `openclaw cron add` is a Gateway client command, so it cannot run before the gateway the entrypoint is about to exec. OpenClaw's config schema also has no `cron.jobs` array; the job store is reachable only through the CLI, against a running gateway.

`cron add` connects over the WebSocket to a running gateway, so the entrypoint cannot run it before exec'ing the gateway, which is where it seemed to belong. Reaching the gateway over the compose network as ws://gateway:18789 is refused: OpenClaw rejects plaintext ws:// to a non-loopback address.

OPENCLAW_STATE_DIR and OPENCLAW_CONFIG_PATH exist, so one mounted directory can hold config, workspace, allowlist, cron store and transcripts.

## Decision

A separate one-shot service, gated on gateway health, registers the job idempotently. What remains open is a host install: someone following the agent deployment notes still registers the job by hand, and a future generator must do the same for anyone not using the image.

A one-shot `provision` compose service (entrypoint mode `provision`) waits on the gateway's healthcheck (`depends_on: condition: service_healthy`) and shares its network stack (`network_mode: "service: gateway"`), so 127.0.0.1 is the gateway. It resolves the token from /config/.gateway-token and idempotently registers `gamereg-checkin` with `--cron "0 * * * *" --exact --no-deliver --agent main --command-env GAMEREG_VAULT=...`.

All gateway state lives under one /config mount.

## Consequences

Host installs carry a manual step (the agent deployment notes step 8). One stale detail: the bullet says provision is gated on `openclaw gateway health`, but the compose health check is now a bare `bash /dev/tcp` connect (compose.yml:82-87), changed after the e2-micro health-check outage. Dockerfile:62-63 says checkin.sh 'is registered as an OpenClaw cron job by the entrypoint'; strictly, that is the entrypoint's `provision` mode run by the provision service. Provision also needs `network_mode: "service: gateway"` because OpenClaw refuses plaintext ws:// to a non-loopback address, and needs the gateway token, or `cron add` fails with GatewayCredentialsRequiredError.

Host installs still register the job by hand (README step 8), and a future generator must do the same for non-image installs. provision restarts on-failure up to 5 times. `provision --dry-run` must not contact the gateway.

provision depends on the gateway health check, and needs the gateway's network namespace (see the 'seven things' item).

## Related

- [agent/checkin.sh](../../agent/checkin.sh)
- Dockerfile
- [compose.yml](../../compose.yml)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [agent/README.md](../../agent/README.md)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
