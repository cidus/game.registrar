# 0041. The wake is a synchronous openclaw agent run, not a second cron job

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Check-ins

## Context

A cron command job's output cannot trigger an agent turn, so the wrapper has to raise it. The candidate written down earlier, a one-shot `cron add --at +0s --message`, works but refuses to deliver without an explicit --channel/--to, which would put a Telegram chat id inside the configuration the distribution phase is meant to generate.

## Decision

The wrapper runs `openclaw agent --agent <id> --message-file <f> --deliver` synchronously. It runs in that agent's main session and delivers over its own channel, so the question lands in the same conversation the answer will arrive in and reaches an agent that knows what it asked. Being synchronous means snoozes are filed only after the wake exits 0, so a down gateway leaves the session eligible next tick instead of silently in backoff.

## Consequences

As written, --reply-to was still needed for buttons, so one chat id ends up in the cron job's environment; this avoids a second job and a second delivery configuration. Now check-ins carry no buttons and CHANNEL/TO are optional (both unset is supported; --deliver routes alone).

## Related

- [agent/checkin.sh](../../agent/checkin.sh)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [compose.yml](../../compose.yml)
- [agent/README.md](../../agent/README.md)
