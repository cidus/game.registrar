# 0112. A photo is removed according to where it lives, and the card says what its paths resolve against

- **Status:** Accepted
- **Date:** 2026-09-25
- **Area:** Agent prompt

## Context

Asked to remove a photo re-sent by mistake, the agent failed twice over, and the
two failures were unrelated.

**It could not read the reference file.** The card's routing table names
`reference/corrections.md`, and the agent resolved that against the workspace,
where the card itself sits: `File not found:
/config/workspace/reference/corrections.md`. Four calls went by — two of them
`exec` attempts denied by the allowlist, since `exec` runs `gamereg` and nothing
else — before it guessed `skills/gamereg/reference/`. The gateway does state the
rule ("when a skill file references a relative path, resolve it against the skill
directory") and does supply the absolute `<location>`, but `AGENTS.md` is a
workspace bootstrap file, not a skill file. The routing table moved into the card
when the card became the index; its resolution base came along in nothing.

`test/agent-skill.test.ts` checked that every routed file exists. It did not
check that the path as written resolves from where the agent stands, which is a
different claim and the one that was false.

**Then it refused, correctly.** With `corrections.md` finally open, it found no
route to a photo's event: `status` lists no photos, and hunting an event id in
the `events` table is what `query.md` forbids. It said so, named the risk of
guessing, and stopped — the never-invent rule working as intended. The refusal
was right and the gap behind it was real.

Investigating it turned up a capability that already existed. The `attachments`
table's `target` column **is** the fold's own key, so for an inline photo it is
the id of the event carrying it. Measured on the live vault:

| filed by | `target` |
|---|---|
| `end --photo`, `start --photo` (inline) | the `session.open` / `session.close` event id |
| `attach` | the game's own id |

An earlier answer in this session declared that id unreachable after reading
`status` and the column list without querying the table. The table had it all
along.

## Decision

**The card names its resolution base.** *Where the rest lives* now says the
paths are relative to the `gamereg` skill directory, not to the card, and that
the gateway supplies that location — with the cost of guessing stated, because
`exec` cannot go looking.

**Photo removal is documented as two flows, chosen by `target`.**

- `target` is an event id: the photo is one item in that event's payload and has
  no event of its own. Revoking it would revoke the session or the close along
  with the photo. The correction is `amend` on that event, replacing
  `attachments`. The patch replaces rather than merges, which is what makes a
  subtraction expressible at all.

  **The surviving array is built by SQL, not assembled by the agent.** One query
  excludes the photo by `sha256` with `NOT IN` and emits the array with
  `json_group_array(json_object(…))`, and its output goes into `--set
  attachments=` verbatim. The first draft of this had the agent read the rows and
  retype the survivors, which is the same two calls with one extra place to be
  wrong: the subtraction happens in a model's head rather than in a `WHERE`
  clause, and every field is copied by hand. `captured_at` is what that costs —
  camera metadata nobody typed, which disappears from a retyped record in
  silence while the result still looks complete. Verified to round-trip: a
  photo carrying `captured_at` keeps it exactly through the query and the amend.

  The `sha256` that matches nothing is the failure mode left, and it is quiet:
  the array comes back whole and the `amend` writes it back unchanged, reporting
  success. The query therefore carries its own `kept` and `total`, and the check
  is `kept = total - (hashes listed)`. The envelope's `count` cannot serve —
  an aggregate returns one row whatever it aggregates, so `count` is always `1`
  and a check against it would have proved nothing.

  **An empty array is a correct outcome, not a guard.** Removing the only photo
  on an event leaves `[]`, which is what the request means; the first draft
  treated zero surviving rows as a condition to stop on, which would have refused
  the plainest case of all. The event itself is untouched either way.
- `target` is the game's id: `attach` filed an event of its own, so `revoke`
  removes the photo and touches nothing else.

**One exception to the event-id prohibition, stated in both files.** No row
carries an `attachment.add`'s id, so that one case queries `events` matching on
`sha256` — unique per stored image, and read from a row the agent already has, so
it resolves to one event rather than to a guess. More than one row, or none,
stops the flow. `query.md` names the exception and points at where it is written
out; `corrections.md` marks it as the exception that proves the rule.

`captured_at` is called out as the field whose omission loses data silently:
camera metadata nobody typed, which the table returns and which simply vanishes
if it is dropped while the record still looks complete. `ext` is not to be
written at all — [0108](0108-an-attachment-has-no-extension-to-vary.md) stopped
the fold reading the payload's value and removed it from the table.

## Consequences

The inline flow is the riskiest thing in `corrections.md`, and building the array
in SQL is what keeps it on the safe side of the never-invent rule: the agent
names one hash to exclude and passes a string through, rather than composing
attachment records. The confirmation `amend` already requires still stands
between a wrong target and the log.

What no test reaches is whether the agent follows the count check. The suite
asserts the instruction is present; a model that skips it turns a mismatched hash
into a silent no-op, which is the same shape as the amend that reported success
while writing nothing ([0094](0094-amend-refuses-foreign-keys.md)).

Verified end to end against the current build, not reasoned about: a session with
two inline photos, amended to one, leaves one row in `attachments`, an asset path
that still resolves, and `doctor` clean.

No CLI change. Exposing an `attachment.add` id on a row would remove the one
query and was considered — it touches `sqlite`, `csv` and `json`, which
[04-derived](../spec/04-derived.md) forbids from disagreeing, plus the goldens.
Worth revisiting if a second flow ever needs that id; one exception did not earn
it.

## Related

- [0105](0105-a-photo-is-attached-in-the-turn-it-arrives.md) — the same incident's other half, and the never-invent rule this leans on
- [0108](0108-an-attachment-has-no-extension-to-vary.md) — why `ext` is not written
- [0101](0101-attachments-are-resolved-to-their-owner.md) — the table and its `target` key
- [0063](0063-procedure-in-the-always-loaded-card.md) — the move that left the routing table without a base
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [agent/skills/gamereg/reference/corrections.md](../../agent/skills/gamereg/reference/corrections.md)
- [agent/skills/gamereg/reference/query.md](../../agent/skills/gamereg/reference/query.md)
