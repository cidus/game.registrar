# 0009. A session nobody recorded is filed with --at, read before write

- **Status:** Accepted
- **Date:** 2026-08-15
- **Area:** Agent prompt

## Context

Two things people say about a session they never opened: "I forgot to log it, I played from 8 to 11 last night", and "I have been playing since around 8". They look like two features and are the same one.

## Decision

Both are `--at` on commands that already exist. A session with both ends known is two calls, the open read before the close is sent, so a failed open never leaves a half-recorded session. A session still running is one `start --at`.

## Consequences

No new CLI surface, and the agent needs no special flow beyond knowing that a stated time is a flag rather than prose.

Because the opening instant decides the logical day, backdating also puts the session on the right day.

## Related

- docs/spec/06-roadmap.md "## Decided" item 6
- agent/workspace/AGENTS.md ("A session nobody recorded is `--at`")
