# 0059. Check-ins carry no buttons and have a single sender

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Check-ins

## Context

An unanswered check-in stays on screen. An hour later its buttons still look tappable while the session they name may be closed, and a tap that cannot work is worse than no tap. Three attempts were made to keep them and teach the agent to strip a stale one (in reference/checkins.md, then the always-loaded card, then generalized to any flow), and all three failed the same way. The third ruled out the obvious explanation by measurement: adding 1000 characters to the deployed AGENTS.md grew the system prompt by 991, so workspace files are re-read every turn and the rule was reaching the model. The model strips a button it created in the same turn reliably; it does not do bookkeeping on a message from an earlier turn while working on something else. Alternative considered: move the send into checkin.sh. That works, but gives a stateless wrapper state and depends on per-channel edit semantics (Telegram drops an inline keyboard on a markup-less editMessageText; Discord needs an explicit empty `components`).

An unanswered check-in stays on screen, and an hour later its buttons still look tappable while the session may be closed. Buttons were also the only reason the wake used the `message` tool. With both `--deliver` and the tool active, every check-in arrived twice: same text and minute, one copy with buttons and one without. The model narrated alongside its tool call and `--deliver` delivered the narration; `NO_REPLY` is matched per payload (`^NO_REPLY$`), and the turn produced two. Three attempts at stripping stale buttons all failed: in the check-in reference, in the always-loaded card, and generalised to any flow. Adding 1000 characters to AGENTS.md grew the system prompt by 991, so the rule was reaching the model; it strips buttons it created in the same turn, but does not do bookkeeping on earlier messages.

## Decision

Remove the buttons from check-ins. Exits are typed. A 'remember to do X later' rule is the weakest kind of prompt instruction; prefer removing the X. It costs one usability affordance and deletes the whole class: nothing to strip, no state, no channel coupling, and one fewer sender (the wake never asks for the message tool, so --deliver is the only path).

Check-in exits are typed ('pausa', 'encerrei às 22h', or silence). The wake never asks for the message tool, so `--deliver` is the only path. When set, GAMEREG_CHECKIN_CHANNEL/_TO become `--reply-channel`/`--reply-to`; they make routing explicit rather than selecting a mode.

## Consequences

Answers are typed ('pausa', 'encerrei às 22h', or nothing). This supersedes the project's working notes Decisions 'One delivery path per wake, never two' the project's working notes, whose mode switch ('routing configured means the message tool sends and --deliver is off') no longer describes checkin.sh. Stale leftovers:.env.example:140-141 ('Without routing the questions still arrive, but as plain text with no inline buttons', implying routing gives buttons); agent/openclaw.example.json5:226 ('message sends buttons, candidate covers, and check-in questions'); agent/workspace/AGENTS.md:22-23 (message tool is for '... check-in questions...'), which contradicts reference/checkins.md:65-67 ('send nothing with the message tool on this turn').

Answers must be typed. Do not reintroduce buttons or the message tool on a wake. Moving the send into checkin.sh was rejected: it would give a stateless wrapper state and depend on per-channel edit semantics. Lesson kept: a 'remember to do X later' prompt rule is the weakest kind; remove the X.

## Related

- [agent/checkin.sh](../../agent/checkin.sh)
- [agent/skills/gamereg/reference/checkins.md](../../agent/skills/gamereg/reference/checkins.md)
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [.env.example](../../.env.example)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- [agent/README.md](../../agent/README.md)
- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [test/checkin-wrapper.test.ts](../../test/checkin-wrapper.test.ts)
- [CHANGELOG.md](../../CHANGELOG.md)
