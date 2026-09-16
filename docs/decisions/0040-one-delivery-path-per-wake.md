# 0040. One delivery path per wake

- **Status:** Superseded by [0059](0059-checkins-have-no-buttons.md)
- **Date:** 2026-08-23
- **Area:** Check-ins

## Context

--deliver and the agent's message tool are both senders; with both on, every check-in arrived twice: identical text, same minute, one copy with buttons and one without. The turn generated nothing twice: the model narrated alongside its tool call and --deliver delivered the narration. NO_REPLY does not help, because OpenClaw matches the sentinel per payload (^NO_REPLY$) and the turn produced two payloads. From inside, every artifact looked correct (one message call, one messageId, one session.checkin); the duplicate was only visible on the phone. The wrapper was also the one caller unable to use the CLI's --at test harness; its first test was built on Date.now and failed depending on the hour of day.

What changed since: agent/checkin.sh:41-56 --at forwarded via gamereg_run. :160-164 wake text says 'send nothing with the message tool'. :208-221 'Exactly one sender... --deliver... is the only path', with --deliver always in the argument list and the reply flags optional. No mode switch exists. test/checkin-wrapper.test.ts:38-43, 302 (--at forwarded to every gamereg call).

## Decision

As written: the wrapper picks by mode. Routing configured means the message tool sends and --deliver is off; no routing means --deliver carries the reply and the message tool is forbidden. checkin.sh gains --at, forwarded to every gamereg call.

## Consequences

Superseded on 2026-09-11 (76426ef, 'drop the buttons from a check-in'). The wake never asks for the message tool, --deliver is always on and is the only path, and GAMEREG_CHECKIN_CHANNEL/_TO no longer pick a mode, they only make routing explicit. The --at half still holds.

## Related

- [agent/checkin.sh](../../agent/checkin.sh)
- [test/checkin-wrapper.test.ts](../../test/checkin-wrapper.test.ts)
- [agent/README.md](../../agent/README.md)
