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
`run_open_event_id` and `run_close_event_id` from `gamereg status <game>`,
which is the only route for a run with no open session; `last_checkin_id` for a
check-in. Entity ids are not interchangeable with them and are cruelly easy to
confuse: for one real session the `session_id` was `01M0JAMZTJQ4W489FNDCREMYB7`
and the `session.open` event was `01M0JAMZTJQ4W489FNDCREMYB8` — same prefix,
different last character. Passing the entity id exits 4, which is how this was
found.

**A run has two of these, and the field decides which one.** `platform`,
`started_on` and the stated `hours` are on the opening event;
`rating`, `difficulty`, `note`, `outcome` and `completion_criteria` are on the
closing one. Getting it wrong exits 2 with that event type's field list, so the
recovery is to read the other id off the same row and repeat the call.

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

## A rating or a difficulty arriving after the run closed

> "put it at 7, easy" -> *(said minutes after `finish` already ran)*

`finish` takes `--rating` and `--difficulty`, but it has already run and there
is no second one. The tool is `amend`, on the run's **`run_close_event_id`** —
these are closing fields, and the event that carries them is the one that
closed the run:

```
gamereg status "Double Dragon" --json
gamereg amend "<run_close_event_id>" --set rating=7 --set difficulty=easy --reason "stated by the user after the run closed" --json
```

**Not `run_open_event_id`.** A `run.open` event has no `rating` and no
`difficulty`; the run reads both from its `run.close`. This is refused at exit
2 now, but it was accepted for a while and recorded nothing while reporting
success, so a run silently kept the rating the user thought they had given it.
If a value you filed earlier is not showing in `status`, this is why, and the
fix is the same call against the other id.

## Removing a photo

> "remove the last photo I sent, it was already there"

**The `attachments` table is the only route.** `status` does not list photos,
and it carries what identifies the photo to the user as well as what to correct:

```
gamereg query "SELECT sha256, caption, captured_at, kind, target, filed_at FROM attachments WHERE game_id = '<game_id>' ORDER BY filed_at" --json
```

Two photos the user calls identical often have different `sha256` — a re-sent
image is recompressed in transit, so content addressing sees two files. Trust
`filed_at` and the caption over "it is the same picture", and name both in the
confirmation so they can tell you which one they meant.

`target` decides which correction applies. The two are not interchangeable.

### `target` is an event id — the photo arrived inline

It came with a `session.open`, `session.close`, `run.close` or `run.import`, and
it is one item inside that event's payload. **There is no event of its own to
revoke**: revoking that event would revoke the session or the close along with
the photo. The correction is an `amend` on that event, replacing `attachments`
with the photos that stay.

**Let the database build the array. Do not assemble it yourself.** One query
returns the string the `amend` takes and the two numbers that prove it is right:

```
gamereg query "SELECT json_group_array(json_object('sha256',sha256,'caption',caption,'captured_at',captured_at,'kind',kind)) FILTER (WHERE sha256 NOT IN ('<sha to remove>')) AS attachments, count(*) FILTER (WHERE sha256 NOT IN ('<sha to remove>')) AS kept, count(*) AS total FROM attachments WHERE target = '<target>'" --json
gamereg amend "<target>" --set attachments='<the attachments string, verbatim>' --reason "duplicate photo removed at the user's request" --json
```

This is the same two calls as reading the rows and retyping the survivors, and it
removes the step where a mistake is invisible. The subtraction happens in SQL,
where it either matched or it did not, and every value is carried by the database
rather than through you. **`captured_at` is the reason this matters** — camera
metadata the user never typed, which would vanish silently from any record you
retyped without it while everything still looked right.

`NOT IN` takes a list, so several photos go in one call — the same list in both
clauses: `NOT IN ('<sha>', '<sha>')`.

**The check is `kept` = `total` minus the number of hashes you listed.** Anything
else and the `amend` would write something you did not mean:

- `kept` equal to `total` — a hash matched nothing. The array came back whole, so
  the `amend` would write it back unchanged and report success. Read the hashes
  off the rows again rather than retyping them from the conversation.
- `kept` lower than expected — a hash you did not intend is in the list, or the
  same photo is filed twice on this event.

**`kept: 0` is a correct answer**, not a guard to trip over: one photo on the
event and one hash listed leaves `[]`, which empties that event's attachments and
is exactly what "remove the photo I sent" means when it was the only one. The
event itself is untouched — the session, the close, the note all stand.

**Do not write an `ext`.** The query does not return one and the register does
not read one: an attachment is stored as WebP by construction, so the hash and
the extension are one fact. Older events still carry the field and it is ignored
where it sits.

The patch **replaces** the array rather than merging into it, which is what makes
a subtraction expressible at all — and also why an empty array empties the event.

### `target` is the game's own id — the photo came from `attach`

`attach` filed an event of its own, so `revoke` removes the photo and touches
nothing else. Its id is the one thing no row carries, and this is the **only**
case in this file where you query for an event id:

```
gamereg query "SELECT event_id FROM events WHERE type = 'attachment.add' AND payload LIKE '%<sha256>%'" --json
gamereg revoke "<event_id>" --reason "duplicate photo removed at the user's request" --json
```

The `sha256` makes it exact — it is unique per stored image, and the row you
matched it from came out of the query above, so nothing here is guessed. One
row back means one event. **More than one row, or none, means stop and say so**:
that is a question for the user, not a thing to pick from.

`query.md` tells you not to look for an event id in the `events` table, and it
is right everywhere else, because everywhere else a row already carries it. Here
no row does, and this query is the exception that proves it rather than a licence
to go hunting.

## Adding a stated baseline to a run already in progress

`--past-hours` is only valid on the call that opens a run. For one already
under way, `amend` its `run.open` — `hours` is the same field name
`--past-hours` writes:

```
gamereg amend "<run_open_event_id>" --set hours=30 --reason "stated by the user" --json
```
