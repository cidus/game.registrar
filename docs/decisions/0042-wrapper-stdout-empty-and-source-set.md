# 0042. The check-in wrapper prints nothing on stdout and sets GAMEREG_SOURCE itself

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Check-ins

## Context

Both found by probing the live gateway, not its docs. A cron command job's delivery.mode defaults to announce, so any stdout is one missing --no-deliver away from being sent to the user as raw text. A command job inherits the gateway process environment, including GAMEREG_SOURCE=chat, so every check-in the poll files would claim in the log to have come from a conversation.

## Decision

checkin.sh keeps stdout empty on every path, including --dry-run, and puts diagnostics on stderr, where `openclaw cron runs` shows them. It sets GAMEREG_SOURCE=cron (a real EVENT_SOURCE) and GAMEREG_NON_INTERACTIVE=1 itself. The job is registered with --no-deliver.

## Consequences

A delivery failure also marks the run status 'error' even when the command exited 0 (per the agent deployment notes).

## Related

- [agent/checkin.sh](../../agent/checkin.sh)
- [test/checkin-wrapper.test.ts](../../test/checkin-wrapper.test.ts)
- [agent/README.md](../../agent/README.md)
