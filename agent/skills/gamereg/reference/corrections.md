# Undoing and correcting

Read this when something already in the register is wrong. Nothing here is
deleted: `revoke` appends an event saying an earlier one does not count, and
`amend` appends a correction. The log is append-only.

**`amend` and `revoke` have no platform approval gate.** The confirmation you
get in chat is the only check there is, so it is not optional:

1. State plainly, in your own words, exactly what will change — the game, the
   field, the old value if you know it, the new value. Not "shall I fix that?";
   say what "that" is.
2. Offer it with buttons (`AGENTS.md`, *Buttons*) — **the sentence from step 1
   goes in the `message` field of that same send**, never as narration beside
   it — and wait for an unambiguous yes. A vague "sure", a change of subject,
   or silence is not one. A tap counts only when its value names *this*
   change.
3. Run the command. `--reason` is required on both; they exit 2 without it.
4. Strip the confirmation's button. Step 4, not an aside: an answered question
   that keeps its button still looks askable.

Never invoke either from inference, from something implied a few turns back,
or because the target "seems obvious". These are how a mistake in an
append-only log gets corrected; they are not how you clean up after yourself.

**The ids they take are event ids, and they are on the row.**
`run_open_event_id` and `session_open_event_id` from `gamereg open`;
`run_open_event_id` from `gamereg status <game>`, which is the only route for a
run with no open session; `last_checkin_id` for a check-in. Entity ids are not
interchangeable with them and are cruelly easy to confuse: for one real session
the `session_id` was `01M0JAMZTJQ4W489FNDCREMYB7` and the `session.open` event
was `01M0JAMZTJQ4W489FNDCREMYB8` — same prefix, different last character.
Passing the entity id exits 4, which is how this was found.

## A session opened by mistake

> "oops, got the wrong game" — wrong game, wrong moment, or they were not
> playing at all.

**The result of the command that made the mess already lists what it wrote.**
`start` returns `events[]`, and that array is exactly what needs undoing:

| What `start` found | `created` | `run_opened` | `events` |
|---|---|---|---|
| a game not on record | `true` | `true` | `game.create`, `run.open`, `session.open` |
| a game on record, no run open | `false` | `true` | `run.open`, `session.open` |
| a game on record, run already open | `false` | `false` | `session.open` |

Do not reason about which case it was. Read the flags, take the ids, and
**revoke them in reverse order** — last written, first revoked.

```
gamereg revoke "<session.open id>" --reason "session opened by mistake" --json
gamereg revoke "<run.open id>" --reason "session opened by mistake" --json
gamereg revoke "<game.create id>" --reason "session opened by mistake" --json
```

Reverse order is not a style preference. Revoking `game.create` while its
`run.open` still stands leaves events pointing at a game that no longer folds,
and `gamereg doctor` reports one orphan reference per event and exits 1. Going
backwards, every intermediate state is one the register already understands — a
run with no sessions is what `past` files every day — so stopping halfway is
safe, and being interrupted is not a corruption.

**Only revoke a `game.create` that this same command wrote.** `created: false`
means the game was already there, and its create event is the root of every
run, session and verdict it has ever had.

If `end` ran before anyone noticed, its `session.close` is one more id, and it
goes first — it was written last.

If the ids are gone because this is a later conversation, `gamereg open` and
`gamereg status <game>` carry the two that matter.

One confirmation covers the whole reverse-order sequence, so it never names a
single event: put the **`session_id`** in the button's value —
`revoke-session:<session_id>` — which names which session is being undone, and
is all the value has to do. **The value is not the revoke target**: when the tap
comes back, go get the event ids as above.

## The wrong game, chosen from the menu

> "no, not that one — I meant the other Zelda"

This is the section above plus one event nobody thinks of, and that one is the
reason it matters.

**Answering a code 3 teaches the register.** Resolving by `--id` files the query
as an alias on the game that was picked, so a wrong pick does not just misplace
one session — it wires the word to the wrong game *permanently*. Ask again
tomorrow and there is no menu: the query resolves straight to the wrong game,
silently, and nothing about the answer looks wrong. The alias is the first
event in the `events[]` the command returned, ahead of the run and the session.
`gamereg alias` only adds; `revoke` on that `game.alias` event is the only way
back.

Same procedure, with one addition that changes the shape of the problem:
**revoke everything filed on that game since, not only what the command
wrote.** A session closed on top of it, a break, a second session, a `finish` —
each points at something you are about to revoke. They were written after, so
they are revoked before.

**Then run `gamereg doctor --json`.** It reports an orphan reference for every
event left pointing at a revoked one, which makes it the check on whether you
caught them all. Clean means clean.

Only then redo it on the right game:

```
gamereg start "<the same words they used>" --id "<the right candidate's ref>" --json
```

The alias is learned again on the way through, this time onto the game they
meant — the same mechanism that caused the problem, working correctly.

A list this long is exactly the case where the confirmation earns its keep, and
exactly the case where a button must not become the whole question: the
sentence names all four things (game, alias, run, session), the button only
carries the value.

## A platform question with no session to answer through

A run filed by `gamereg past` never had a session. It can sit with
`platform: null` indefinitely, and the only way it comes up is the user asking
directly, not an `end`/`finish`/`drop` reply.

> "what platform is this game on?" -> *(you check, it's null)* -> "PS5"

There is no `end` to attach `--platform` to. The tool is `amend`, on the run's
own `run.open` event, and `gamereg status <game>` hands you its id directly:

```
gamereg amend "<run_open_event_id>" --set platform="PS5" --reason "platform stated by the user" --json
```

**Do not try `start --platform` on the title, looking for a shortcut.** It will
not fail, and that is the problem: `start` opens a *new* run and a *new*
session stamped with the platform you passed, while the run the user was
talking about keeps its `null`. You would have answered a question about
January by starting to play today.

The confirmation applies in full, and here the rule that a value names the
action is not a nicety: `amend-platform:<id of the event being amended>`, so a
tap arriving late cannot be read as consent to whatever is pending now.

## Adding a stated baseline to a run already in progress

`--past-hours` is only valid on the call that opens a run. For one already
under way, `amend` its `run.open` — `hours` is the same field name
`--past-hours` writes:

```
gamereg amend "<run_open_event_id>" --set hours=30 --reason "stated by the user" --json
```
