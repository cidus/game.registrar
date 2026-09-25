# 0110. The diary is not the "feed" the non-goals rule out; a verdict gets a synthetic end-of-day sort key, and the front page a count rather than a window

- **Status:** Accepted
- **Date:** 2026-09-24
- **Area:** Site and comments

## Context

A prototype built in Eleventy against the real vault found that a chronological
page mixing session notes, session photos and run verdicts was the most
readable view of a register that exists — more so than the per-game note or the
consolidated table. Porting that finding to `quartz` as
`quartz/content/diary/<year>.md` raises two questions a reviewer will ask
immediately.

First: [00-architecture](../spec/00-architecture.md)'s non-goals say plainly
"**Not social.** The register has no profiles, no following and no feed." A
page that is, in plain terms, a timeline reads like exactly that.

Second: a session has a timestamp (`started_at`), but a run's closing date
(`ended_on`) is a *date*, stored at day precision. Placing both kinds of entry
on one sorted timeline needs a rule for where a date-only event falls among
timestamped ones, and the rule has to be explicit — invariant 2 (idempotent
build) and 04-derived's *Determinism* both require stable sort keys, never an
implicit one that happens to work today.

Third: the diary turned out to be the better landing page for the site, which
raised the obvious request — make the front page "the last 30 days". That
phrasing needs a *now* to subtract from, and the register does not have one.
The failure is not hypothetical: `example-vault`'s newest session is
2026-08-15, so a 30-day window would already render that fixture's front page
empty, and the committed golden file would change bytes every day with no
event behind the change. That is invariant 2 broken by a feature nobody would
think to test for it — the same trap [ADR 0047](0047-review-reads-no-clock.md)
records for the year in review.

## Decision

**The diary is not the feed.** The non-goal is about *other people's*
activity — profiles, following, a stream of what others played. The diary has
none of that: it is the user's own log, re-cut by time instead of by game,
exactly as `reviews/` already re-cuts it by year and `stats.md` by genre. No
new fact enters the register; every line already exists in a run note or a
game note today. The nearby non-goal in
[07-targets](../spec/07-targets.md) — "not a site feed, and not to be widened
into one" — is about `data/export.json` specifically, and its own last line
supports this design: nothing reads that file to build the site; `quartz`
plans from folded state, which is exactly what the diary does too.

**A verdict sorts on `${ended_on}T23:59:59`, ties broken by `run_id`.** This
places a run's closure after the last session of the day it closed on, which
is the real order of events — a session happened, then (on the same day or
later) the run was judged. The timestamp is synthetic and is never written
anywhere or read back; it exists only to give `Array.prototype.sort` a total
order across the two entry kinds. An open run (`ended_on` still null) produces
no verdict entry, so no run needs a sort key before it has one to give.

**The front page carries the N most recent entries — a count, not a window.**
`HOME_ENTRIES` is 30. The list is anchored to the log: take every entry, sort,
keep the first N. Nothing subtracts from a clock, so a build in December and
one the following January produce the same bytes. A count also keeps the page
a known size whether the last month held forty sessions or one, and cannot
render empty while the register holds anything at all — a register whose last
session was in 2019 shows its 2019 entries, which is a true statement about
that register rather than a blank page implying nothing was ever played.

The consolidated table the diary displaced keeps its own page,
`quartz/content/all-games.md`. It is not deleted and not merged into the front
page: it is the whole register, and a landing page is not the place for a
table that grows without bound. The vault is untouched — `Game List.md` is
still Obsidian's front page and still has no diary
([ADR 0053](0053-front-page-names.md)).

**A photo whose narrowest owner is the game is its own entry.** `attach` takes
a game as readily as an event, and such a photo has a date and a game and
nothing narrower. The first implementation had a branch for a session photo and
one for a run photo and none for this, which silently dropped every game-level
photo in the register — the entry model was stated as two kinds and the code
matched the statement, so neither caught it. Grouped per game per day, dated by
`captured_at` falling back to `filed_at`, and never folded into a session that
merely shares the day.

## Consequences

The diary is Quartz-only for now (the vault already has the Bases view for
querying, and this is a reading experience), and reachable only by a link from
the year in review — not from a separate feed of its own that a future reader
might reasonably ask to follow, comment on or receive notifications from. If
that ever changes, this record is the one to revisit first.

`test/diary.test.ts` has the tie case directly: a verdict and a session on the
same day, asserting the verdict's meta line appears before the session's in
the rendered page (reverse-chronological display of a forward sort key).
`test/quartz-target.test.ts` asserts the front page is non-empty for a fixture
whose newest entry is months old, which is the assertion a clock-based window
would fail.

What would reopen the front-page rule: a register active enough that 30
entries cover two days, making the page read as "this week" when it means
"the last 30 things". The fix then is a larger N, or the window-with-a-floor
shape considered and set aside here — not a clock.

## Related

- [docs/spec/00-architecture.md](../spec/00-architecture.md) — the non-goals
- [docs/spec/04-derived.md](../spec/04-derived.md) — *Diary*
- [docs/spec/07-targets.md](../spec/07-targets.md) — the `quartz` section
- [ADR 0047](0047-review-reads-no-clock.md) — the same no-clock rule, applied
  to which years exist at all
- [ADR 0058](0058-astro-gets-a-projection.md) — where a richer, feed-shaped
  consumer belongs instead, if one is ever needed
- [src/render/diary.ts](../../src/render/diary.ts)
- [test/diary.test.ts](../../test/diary.test.ts)
