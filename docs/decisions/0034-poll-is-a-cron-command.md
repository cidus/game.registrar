# 0034. The hourly check-in poll is a cron command, not a heartbeat or an agent turn

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Check-ins

## Context

`gamereg due` already decides whether there is anything to say. A model-driven heartbeat would re-decide what the CLI decided, and heartbeat was already in use: notifyOnExit can wake the agent when a backgrounded exec call finishes (the bullet cites the button-strip edit in *Confirmations* as one).

## Decision

Register the hourly poll as an OpenClaw cron command job: the binary with no model attached, so an empty poll is free. The caller stays dumb. AGENTS.md tells the agent to answer HEARTBEAT_OK and stop on a heartbeat rather than improvise a comment.

## Consequences

Registered as --cron '0 * * * *' --exact --no-deliver (not --every 1h, which counts from registration; --exact zeroes stagger because chase_at is a delivery slot).

## Related

- [agent/checkin.sh](../../agent/checkin.sh)
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [agent/README.md](../../agent/README.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- docs/spec/05-agent.md:324-332
