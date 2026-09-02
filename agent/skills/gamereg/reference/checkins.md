# Check-ins

Once in a while a message arrives that nobody in the conversation sent. It
opens with `gamereg check-in.` and carries a JSON array of open sessions, each
with a `trigger`, a `threshold`, an `opened_at`, an `open_for_minutes` and a
`net_minutes`. A poll on this host ran `gamereg due`, got that array back, and
woke you with it.

**Never run `gamereg due` or `gamereg checkin`.** They belong to the poll. It
already decided these sessions were worth a question — thresholds, quiet hours,
backoff, how many times this session has been asked already — and it files the
record of the asking itself, the moment it hands the array to you.

**The facts are the facts.** The elapsed time, the game, the opening hour and
the trigger are in the array. Do not add them up, round them, or re-derive them
from the clock, and do not check them against `gamereg open` first. This is the
one message you send without having run anything.

**If the array names a session the register does not have, the poll's facts are
stale — say so in one line and stop.** Do not investigate, do not query the
`events` table, do not act on the nearest-looking open session instead. Seen
live: a wake naming a game with no session anywhere in the log produced a
`break start` on a *different* game, then ten diagnostic queries, then a break
that had to be revoked. Twenty-five commands, all of them after the first
contradiction, none of them able to make the wake's facts true. One sentence
saying the check-in refers to a session that is no longer open costs nothing and
is always correct.

**One message, however many sessions.** Two sessions standing open is one
message naming both, never one message each. Each still gets its own answer.

**The wake tells you which language to ask in.** Nobody wrote anything here, so
there is nothing to read it off; the wake names the register's configured
locale instead. Use it unless this conversation has already settled on another
language. Do not go looking through session history or memory for the answer.

**No reaction on a check-in wake.** That turn has no ordinary inbound message
for a reaction to default to.

## The register, by trigger

The phrasing is yours and it is generated fresh every time. A fixed string read
for the tenth time stops being funny and starts being a notification, which is
the thing this feature must not become. What the trigger fixes is the
*register*, not the words:

| `trigger` | What actually happened | How it reads |
|---|---|---|
| `duration` | The session has stood open longer than `threshold` | Curious. You have no data to collect — you noticed, and a pause is worth offering |
| `clock` | The hour in `threshold` came round with the session still open | Gently practical. Less than curiosity; a remark about the time |
| `day_cutoff` | The session was still open when the day rolled over, and nobody ever closed it | Formal. You are chasing a closing time the register does not have |

`day_cutoff` is the only one that wants something. Say the game and the opening
time — they are anchoring against a night that is over, and "I stopped around
1am" is the best answer you are going to get. The other two collect nothing and
may be ignored at no cost to the record.

**You offer; you never judge.** "Worth a pause?" is an invitation. "You have
been playing too long" is a different product and a worse one. Nothing in the
array is a verdict on how someone spends an evening, and eight hours is a fact,
not a problem.

## The three exits

Give the first two as buttons, in the shape `AGENTS.md` gives, and leave the
message answerable in plain text as always. `value` names the session:
`break-start:<session_id>` and `close-session:<session_id>` both fit under 64
bytes. "Still going" needs no button — saying nothing is already that answer.

**Never set `target` on the message tool here, and do not guess one.** This turn
was started by a poll rather than by something someone sent, so nothing in your
context names this conversation — and a bare channel name is not a fallback, it
is a different chat that will accept the message and show it to strangers. The
routing came in with the wake; leaving `target` off is what uses it.

**One of the two carries the message, and the wake says which.** When it gives
you buttons to send, that send is the whole message and your own reply text goes
nowhere — write `NO_REPLY` and nothing else, because anything else is written to
no one. When it tells you it has no delivery target, the opposite holds: ask in
plain text, send nothing with the message tool, and your reply is what arrives.
Doing both at once is what makes a check-in turn up twice.

| What they answer | What you run |
|---|---|
| taking a break | `gamereg break start --id game:<game_id>` |
| stopping now, with impressions | `gamereg end --id game:<game_id> --note "<their words>"` |
| still going, or nothing at all | nothing |

**Both take the target from the row, and passing it is not optional.** The
`game_id` is in the array the wake handed you. Neither command takes a session
id — a game has at most one open session, so naming the game names the session —
and neither guesses: with another session open and no target, they exit 3 and
list them. That exit is the CLI being careful, but it is a question you already
have the answer to, and asking it back would be asking someone to identify the
session you just asked them about.

Nothing here closes a session on its own, and nothing here estimates a
duration. If they say they stopped "a while ago", the closing time is theirs to
give — ask for it, or file what they say and correct it if they offer better. A
guessed number corrupts every statistic downstream and nothing downstream
reports it.

## Settling the record

When one of the first two answers lands, the check-in the poll filed still reads
`snoozed`, and 45 minutes later a sweep on this host will read that as silence
and amend it to `no_reply`. Correcting it is the one piece of check-in
bookkeeping that is yours:

```text
gamereg amend <checkin_id> --set outcome=break_started --reason "answered the check-in"
gamereg amend <checkin_id> --set outcome=session_closed --reason "answered the check-in"
```

`--reason` is required and the command exits 2 without it. The id is
`last_checkin_id`, on that session's row from `gamereg open --json`.

**Read it before you close the session** — `open` lists open sessions, so a
session you have just ended is not there to read it from. For "stopping now"
that means `gamereg open --json`, then `gamereg end`, then the amend. For
"taking a break" the order does not matter; a break leaves the session open.

This is the one place the confirmation rule for `amend` does not apply: you are
not correcting the register on someone's behalf, you are recording the answer
they just gave to a question you just asked. Ask for nothing, say nothing about
it, and never mention the id.

"Still going" is already `snoozed` and needs no amend. Neither does silence.
