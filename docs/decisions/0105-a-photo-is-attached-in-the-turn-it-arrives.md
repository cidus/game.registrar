# 0105. A photo is attached in the turn it arrives, and nothing is invented to explain a failure

- **Status:** Accepted
- **Date:** 2026-09-22
- **Area:** Agent prompt

## Context

`reference/media.md` told the agent that a photo arriving while a session was
open should be "held" and "sent with `end`". In a real session the agent read
that as a later step: it ran `gamereg end --json` with no `--photo` at all,
then tried to attach the two held photos in a separate `attach` call two
minutes and several turns afterward. By then it no longer had the literal
paths and fabricated two — reusing a third photo's staging directory with two
invented file UUIDs. Neither file had ever existed; the real ones, still on
disk a week later, were never touched.

Confronted with the failure, the agent told the user a temp-file cleanup job
had swept the files. No such job exists and nothing swept anything: it was an
invented cause for a failure whose real cause (its own fabrication) it could
not see. That is the more serious half. A wrong path produces an error; an
invented explanation produces a user who believes something false.

**Why the photo was held at all turns out to be historical.** The rule dates
from `fe2d1c1` (2026-08-14), the first commit of the agent layer, when
`gamereg open` exposed `session_id`, `run_id`, `game_id` and no event id.
Attaching immediately then meant a game query, which files the photo against
the *game*:

| target | `game_id` | `run_id` | `session_id` |
|---|---|---|---|
| `attach "<title>"` | yes | **empty** | **empty** |
| `attach <session_open_event_id>` | yes | yes | yes |
| `end --photo` | yes | yes | yes |

Measured on a clean vault; `filed_at` is correct in all three. So holding was
the only cheap way to get a photo onto the session, and the right choice for
August. `session_open_event_id` landed on the `gamereg open` row in `ef40f2d`
(2026-08-31), added for `amend`'s sake, and removed the constraint — but
nothing revisited the photo rule, which kept working by inertia until it cost
two fabricated paths a month later.

## Decision

Two rules, from one incident.

**A photo arriving while a session is open is attached in the turn it
arrives**, with `gamereg attach "<session_open_event_id>" --photo "<path>"`.
Nothing is held, so no path has to survive a turn. `end --photo` remains
correct for a photo arriving *with* the message that ends the session, where
there is no waiting to do. `reference/media.md` and `reference/cli.md` both
name the failure mode of a game query — it attaches to the wrong owner without
failing — and the card's event-id rule covers `attach` alongside `amend` and
`revoke`.

**Nothing is invented to fill a gap in what is known.** `AGENTS.md`'s
"never invent an id, a ref, a hash, a platform, a rating or a time" is widened
to name **a media path**, since a path from a few turns back invites the same
fabrication as an id. A second rule states the general case: a failure whose
cause is unknown is reported as unknown, never given an invented one. This is
deliberately not scoped to photos or to paths — the cleanup job that never
existed was not a path problem.

## Consequences

The first rule removes a class of bug rather than guarding it: there is no
interval in which a value must survive, so no reminder to be careful with it is
needed. Same shape as [0009](0009-unrecorded-session-uses-at.md) (read before
write) and [0059](0059-checkins-have-no-buttons.md) (the button that outlived
its question was removed, not tracked).

Cost: one `attach` invocation per photo instead of one batched `end`. Neutral
against [0072](0072-agent-turn-command-budget.md), because each photo arrives
in its own message and therefore its own turn anyway. The `--kind` decision
improves as a side effect — it is made per image rather than once for a batch,
and a batch holding a screenshot and a box photo was wrong by construction.

Ordering between photos in one session is unchanged and was never preserved:
derived rows sort by `filed_at|target|sha256`, so photos filed in the same
second already order by hash. Not a regression and not an improvement.

The second rule is the one nothing can test. `test/agent-skill.test.ts` asserts
that the card still *says* it, which is all a test can reach; whether a model
obeys it under pressure is visible only in a transcript. Worth stating anyway,
because the failure it names was more damaging than the mechanical one beside
it and would otherwise have no record at all.

## Related

- [0104](0104-attach-reports-every-bad-photo.md) — the CLI half of the same incident
- [agent/skills/gamereg/reference/media.md](../../agent/skills/gamereg/reference/media.md)
- [agent/skills/gamereg/reference/cli.md](../../agent/skills/gamereg/reference/cli.md)
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [src/core/attachments.ts](../../src/core/attachments.ts) — the owner resolution the table measures
- [0101](0101-attachments-are-resolved-to-their-owner.md)
- [0070](0070-prompt-states-rules-not-incidents.md)
