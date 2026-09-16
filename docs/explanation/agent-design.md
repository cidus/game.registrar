# The agent layer, and why it is shaped this way

The chat agent turns a message into a `gamereg` invocation and relays the
result. It is optional: the CLI works without it and nothing in `src/` depends
on it. [05-agent](../spec/05-agent.md) is the specification; this page explains
the design behind it. To set one up, see [Chat agent](../guides/chat-agent.md).

## The boundary

The agent does not read or write vault files, does not compute durations, and
does not invent identifiers. Every number it reports came from the database,
because it had to ask the CLI like any other caller.

That boundary is what keeps the register correct when the model is wrong. A
mis-heard title costs one alias. A model doing its own arithmetic would cost
every statistic downstream, silently, and you would find out months later. It
is the same reason the CLI is the only writer at all
([D2](../spec/00-architecture.md#d2--the-cli-is-the-only-writer)) and that
durations and state are computed in code (invariant 7).

## How a message becomes a command

A turn is one or two commands. Reading before writing is allowed — `search`,
then `start --id` — but a turn that fans out into a dozen calls is a turn that
has started improvising
([ADR 0072](../decisions/0072-agent-turn-command-budget.md)).

Ambiguity is not resolved by the model. The CLI returns candidates with exit
code 3, and the agent renders them as buttons; the user picks. A title is
completed only when the user's own words are unambiguous: the agent corrects
*how* a title is written, never *which* game was meant
([ADR 0020](../decisions/0020-agent-corrects-spelling-never-the-game.md)).

Exit codes are the CLI's contract, and the gateway does not know that: it
prints a failed-exec warning for any non-zero exit, so a flow working exactly
as designed can put a warning on the user's screen. Rather than make the CLI
lie, the prompt leads with calls that exit 0 — `search` answers both "is this
on record" and "what does the catalog have"
([ADR 0017](../decisions/0017-agent-leads-with-exit-zero-calls.md)).

## Where the prompt lives

One fact about the gateway decides the layout: `workspace/*.md` is compiled
into the system prompt on every turn and cached there, while a skill body is a
`read` the model pays for, mid-turn, once per session.

| Where | What is in it | Cost |
|---|---|---|
| `workspace/AGENTS.md` | The operating card: boundary, JSON contract, the common path, buttons, safety, the routing table | Always in context |
| `workspace/SOUL.md` | Voice, and the register's vocabulary | Always in context |
| `skills/gamereg/SKILL.md` | A pointer back to the card | One small read |
| `skills/gamereg/reference/*.md` | One file per rare flow: the CLI surface, SQL, media, corrections, check-ins | Read only when that flow happens |

A session that opens, pauses, resumes, finishes and files a verdict reads no
file at all; a correction reads exactly the one that covers it. The procedure
therefore belongs in the cached card and the rare flows outside it
([ADR 0063](../decisions/0063-procedure-in-the-always-loaded-card.md)), which
also means the card is code rather than the user's file — customization goes in
`USER.md` ([ADR 0097](../decisions/0097-agents-md-is-code.md)).

Three rules about that prompt were each learned by breaking them:

- **Examples are whole tool calls**, never the interesting fragment of one: the
  model invents a plausible wrapper around a fragment
  ([ADR 0069](../decisions/0069-prompt-examples-are-whole-calls.md)).
- **An obligation that applies in any flow goes in the card**, not in the
  branch file for the flow that created it
  ([ADR 0093](../decisions/0093-flow-independent-rules-in-the-card.md)).
- **The deployed prompt cites no repository path**: the agent's workspace holds
  copies, not a checkout, and a path it cannot read is an invitation to guess
  one ([ADR 0071](../decisions/0071-prompt-cites-no-repository-paths.md)).

## The tool surface is part of the prompt

A tool the agent can see is a tool it will eventually reach for, whatever the
prompt says. Two files forbade reading session history and keeping notes, in
bold, and the transcripts still showed both being tried. The fix was not more
prose but fewer tools: `tools.allow` is `exec`, `message` and `read`
([ADR 0064](../decisions/0064-boundaries-by-tools-allow.md)). Nightly memory
consolidation is disabled for the same reason — it wrote into the prompt an
archive the agent had no tool to query
([ADR 0098](../decisions/0098-dreaming-disabled.md)).

Where a rule and an affordance disagree, remove the affordance.

## Buttons

Only one Telegram button shape delivers a tap back to the agent on the pinned
gateway version: a raw `value`, never `action: {type: "callback"}` — which is
the shape the upstream documentation pushes you toward
([ADR 0018](../decisions/0018-telegram-buttons-use-raw-value.md)). Four
consequences shape the flows:

- Callback data is capped at 64 bytes and a longer one is dropped silently, so
  a button carries an id, never a title.
- A row holds three buttons.
- Buttons attach only to the first media item of a multi-media send, which is
  why a candidate menu is one message per candidate.
- A tap comes back carrying the media of the message the button was on, so a
  tap on a candidate's cover looks exactly like a photo the user just sent, and
  has to be handled as such.

## Check-ins

The register speaks first when a session has been open too long, or is still
open the next morning. The clock belongs to the CLI and the words belong to the
agent.

`gamereg due` decides in code whether anything is owed: three triggers
(duration, wall clock, and the day cutoff), a delivery slot for the morning
chase, quiet hours, an escalating backoff and a hard ceiling. It returns at
most one row per session, because a session can stand fired on all three at
once and three messages about one session is the nagging the feature exists to
avoid ([ADR 0032](../decisions/0032-one-due-row-per-session.md)). Quiet hours
are evaluated against now, not against the moment the trigger fired, so a
question withheld at 03:00 simply arrives with the morning
([ADR 0033](../decisions/0033-quiet-hours-evaluated-now.md)).

An hourly cron **command** runs the wrapper, not a model: an empty poll costs
nothing ([ADR 0034](../decisions/0034-poll-is-a-cron-command.md)). When
something is due, the wrapper wakes the agent synchronously and files the
check-in only after the wake succeeds, so a gateway that was down leaves the
session eligible next tick instead of silently in backoff
([ADR 0031](../decisions/0031-wrapper-files-checkin-after-wake.md)).

A wake carries none of the context an inbound message gives for free: the
delivery routing, the session, and the language are all handed to it explicitly
([ADR 0039](../decisions/0039-wake-is-handed-what-it-cannot-infer.md)). And a
check-in carries no buttons: an unanswered one stays on screen, and an hour
later its buttons still look tappable while the session they name may be
closed. Removing them also left exactly one sender, which is what stopped every
check-in arriving twice
([ADR 0059](../decisions/0059-checkins-have-no-buttons.md)).

## Corrections

`amend` and `revoke` are ordinary allowlisted commands, confirmed
conversationally rather than through the platform's approval gate, which proved
unreliable in practice
([ADR 0008](../decisions/0008-amend-revoke-confirmed-in-conversation.md)). What
that costs is stated plainly there: nothing but the prompt stops a wrong
`amend`. Nothing is destroyed either way, because the log is append-only.

Two changes made corrections cheap enough that the agent stopped inventing
ways to find event ids: `open` and `status` expose the ids a correction needs
([ADR 0065](../decisions/0065-status-exposes-correctable-event-ids.md)), and
`amend` refuses a field the target event does not carry instead of accepting it
and doing nothing
([ADR 0094](../decisions/0094-amend-refuses-foreign-keys.md)).

## Reactions

A reaction is a second call, not part of the reply: the gateway's presentation
blocks have no sticker member. Five tokens (`filed`, `approved`, `archived`,
`pending`, `puzzled`) are identifiers and are never translated — four of them
collide with words the persona says out loud, and a translated token silently
matches nothing
([ADR 0044](../decisions/0044-reactions-are-a-second-call.md),
[ADR 0045](../decisions/0045-reaction-tokens-never-translated.md)). The mapping
is a per-installation workspace file; no artwork ships.

## What the agent does not do

Vault maintenance — enrich, build, commit, push — is a periodic external
script, not something the agent fires in the background. A build invoked while
another is running exits immediately rather than queueing, so two session
closes near each other silently lost a build
([ADR 0062](../decisions/0062-maintenance-is-an-external-script.md)).

The agent also keeps no glossary. It asks the CLI for words with `gamereg
vocab`, which serves terms and never sentence templates: a word cannot be
filled in and fabricated
([ADR 0019](../decisions/0019-agent-gets-words-not-sentences.md)).

## The persona

The Registrar has a voice, and the voice is a workspace file rather than a
setting in the register's own configuration. Its aside allowance is stated as
the three moments where an aside *does* belong, because a list of prohibitions
made emitting nothing the safest move
([ADR 0066](../decisions/0066-persona-asides-positive-triggers.md)). The
persona belongs to prose output only: JSON output and event payloads stay
neutral.
