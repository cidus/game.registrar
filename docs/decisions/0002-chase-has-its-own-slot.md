# 0002. The morning chase has its own delivery slot, separate from day_cutoff

- **Status:** Accepted
- **Date:** 2026-08-12
- **Area:** Check-ins

## Context

A session left open overnight is the case the register cannot resolve on its own: nobody recorded a closing time, and the longer it waits the less anyone remembers. Two different questions were being answered by one setting. `day_cutoff` says when the logical day flips, which is when such a session becomes a problem. It is also, typically, 05:00 — a terrible moment to ask anyone anything.

## Decision

Keep them as separate keys. `day_cutoff` decides when the chase trigger fires; `chase_at` (default 09:00) decides when the question is delivered. A trigger that has fired stays fired until it is delivered, so nothing is lost by waiting for the slot.

## Consequences

The hourly poll has to be aligned to the hour (`--cron` with `--exact`): a job that ticks at 09:58 delivers the morning chase 58 minutes late.

The chase is exempt from the backoff ladder and the per-session ceiling, because it has a budget of its own — one per delivery slot. A session left open for three days is chased three times, not hourly.

## Related

- docs/spec/05-agent.md:346-374
