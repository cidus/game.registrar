# 0109. A run's note and verdict reach the derived artifacts as columns on `runs`

- **Status:** Accepted
- **Date:** 2026-09-24
- **Area:** Build and targets

## Context

[0101](0101-attachments-are-resolved-to-their-owner.md) made photos reachable
from the derived artifacts, and [0107](0107-the-cover-is-three-columns-on-games.md)
did the same for covers. This is the third instance of one shape: the fold
already holds the value, no derived artifact emits it, and a consumer outside
this repository has to parse Markdown to get it back.

`RunState.verdict` has existed as long as `run.verdict` has. It is folded with
last-wins semantics — "filing again replaces the previous verdict; both stay in
the file" — and then read by exactly two things, both of them note writers. A
site consuming `data/log.db` can already render a diary of sessions, photos and
covers with no gamereg target enabled; the verdict is the last field missing,
and the absence is visible rather than theoretical. A real diary built that way
shows **2 closure entries instead of 15**, because only the runs that happen to
have a photo can be rendered at all. Getting the verdict without this column
means pulling `<!-- gamereg:begin block=verdict -->` out of a run note, which
couples the consumer to whichever note-writing target is enabled — the coupling
invariant 8 exists to prevent.

`run.note` is in the same position and worse: it reaches **no** artifact at all,
derived or Markdown. The run note does not render it. Folded, then dropped.

### The sentence this contradicts

[07-targets](../spec/07-targets.md) was rewritten by 0107 — the very change that
added the cover columns — to say the opposite:

> …while genres and platforms are multi-valued and live in join tables the
> flattening drops, and `run.note` and the verdict are prose a spreadsheet cell
> has nowhere to put. Adding the last four would break what makes this useful to
> a spreadsheet…

That sentence draws a line between prose and not-prose. **The shipped schema
already crosses it.** `sessions.note` is prose, is a TEXT column, and has been
flattened to CSV and JSON since the schema existed; nothing about it broke a
spreadsheet. Measured on the live vault:

| | rows | min | median | max | with a line break |
|---|---|---|---|---|---|
| `sessions.note` (already emitted) | 29 | 11 | 69 | 228 | 0 |
| `run.verdict` (this record) | 16 | 66 | 188 | 511 | 2 |

A verdict is about 2.7× the median session note and caps at 511 characters.
Longer, not categorically different.

The one genuinely new thing is the **embedded line break** — 2 of 16 verdicts
carry one, and no session note in that vault does. It is not a blocker either:
`encodeCsv` has quoted and escaped correctly since the target was written, and
`test/csv.test.ts` has asserted the round-trip for a synthetic `'has\nnewline'`
the whole time. What was missing was a fixture that made a golden file exercise
it.

## Decision

`runs` gains `note TEXT` and `verdict TEXT`, both nullable, and `csv` and `json`
follow as [07-targets](../spec/07-targets.md) requires. The columns carry what
the fold holds: `note` from `run.close` / `run.import`, `verdict` from the
latest `run.verdict`. A revoked verdict is null, indistinguishable from one
never filed, because the fold never applied the event.

**Both, in one change, rather than the verdict alone.** The 07-targets sentence
names four things. Removing one of them and leaving `run.note` behind means the
same paragraph gets rewritten again the next time somebody notices, and the
argument that settles one settles the other exactly — same kind of value, same
`TEXT` column, same `sessions.note` precedent. `run.note` is in fact the weaker
case for leaving out, since it reaches nothing at all today.

The line 07-targets draws is rewritten to **multi-valued**, not prose. Genres
and platforms are many per game, live in join tables, and could not be
flattened without inventing a separator the format does not define. That is a
real constraint. "Prose" was not one.

## Consequences

**A row is not a line.** `runs.csv` now spans more lines than it has rows
whenever a verdict contains a blank line. Every spreadsheet and every CSV parser
reads this correctly; a hand-rolled `split('\n')` does not. `test/csv.test.ts`
read its own fixture that way and was the first thing the column broke, which is
the cheapest possible demonstration that the case is real. It reads through
`parseCsv` now, and `test/run-prose-columns.test.ts` asserts that a naive line
split gains lines while the row count does not move.

**`example-vault/` grew the shapes the fixture could not teach.** It carried one
verdict across five runs. It now carries a verdict filed twice for one run (the
live vault has this case — 16 filings across 15 runs — and the fixture did not),
a verdict filed and then revoked, and the multi-line verdict it already had,
which reaches a derived artifact for the first time. Runs with neither piece of
prose emit null, not an empty string.

**No change to `01-model.md`.** `run.verdict` is already an event with a `text`
payload and `run.close` already carries `note`; this is the derived layer
catching up. "New column" reads like a model change and is not one — the
project's rule is to ask before touching the model, and there is nothing here to
ask about.

**This is not the nested projection.** [0058](0058-astro-gets-a-projection.md)
is unaffected: what a generator wants from `data/export.json` is *shape* — each
game with its runs, each run with its sessions — and no flat column changes
that. Two of the four fields 0058 lists as missing are now present; the decision
rests on the third thing it names, which is nesting.

Invariant 8 is what improves, for the third time in this series: the gap was
forcing a consumer to read a note's markers to learn what someone thought of a
playthrough.

## Related

- [src/db/schema.ts](../../src/db/schema.ts), [src/db/build.ts](../../src/db/build.ts)
- [src/targets/csv.ts](../../src/targets/csv.ts), [src/targets/json.ts](../../src/targets/json.ts)
- [src/core/fold.ts](../../src/core/fold.ts) — `run.verdict`, and the last-wins comment
- [test/run-prose-columns.test.ts](../../test/run-prose-columns.test.ts)
- [docs/spec/04-derived.md](../spec/04-derived.md#sqlite), [docs/spec/07-targets.md](../spec/07-targets.md#the-targets)
- [agent/skills/gamereg/reference/query.md](../../agent/skills/gamereg/reference/query.md)
- [0101](0101-attachments-are-resolved-to-their-owner.md) and [0107](0107-the-cover-is-three-columns-on-games.md) — the same job for photos and covers
- [0050](0050-review-prose-has-no-command.md) — why the verdict is prose and stays prose
- [0057](0057-imported-verdict-is-its-own-event.md) — why an imported verdict is its own event
- [0058](0058-astro-gets-a-projection.md) — the nested projection this is still not
- [0068](0068-query-reference-mirrors-the-schema.md) — the test that held the reference to this schema
