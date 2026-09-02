# Answering questions with SQL

```
gamereg query "SELECT title, hours FROM v_finished ORDER BY rating DESC LIMIT 5" --json
```

The database does the arithmetic. You write the SQL and narrate the rows — you
never add up hours, average a rating, or count runs yourself. A number you
computed is a number that can be wrong; a number the database computed cannot.

## What there is

**Never guess a name or a column; both are listed here.** A wrong one exits 2
and the failed-exec warning reaches the user.

**Tables** — normalized, and what to reach for when no view fits:

| Table | Columns |
|---|---|
| `games` | `game_id`, `slug`, `title`, `release_year`, `developer`, `publisher`, `status` |
| `runs` | `run_id`, `game_id`, `platform`, `platform_raw`, `form`, `mode`, `started_on`, `ended_on`, `outcome`, `completion_criteria`, `rating`, `difficulty`, `minutes`, `hours_source`, `replay` |
| `sessions` | `session_id`, `run_id`, `started_at`, `ended_at`, `minutes`, `logical_day`, `note` |
| `breaks` | `break_id`, `session_id`, `started_at`, `ended_at`, `minutes` |
| `game_platforms` | `game_id`, `platform` |
| `game_genres` | `game_id`, `genre` |
| `aliases` | `game_id`, `alias` |
| `events` | `event_id`, `ts`, `type`, `source`, `payload` |

**`runs.platform` is the platform a playthrough happened on;
`game_platforms.platform` is every platform the game exists on.** A question
about what someone played wants the first. The second is catalog metadata and
will multiply rows if you join it without meaning to.

```
gamereg query --schema --json
```

A fallback, not a first move: use it when a column above does not behave as you
expect. A test holds these lists to the real schema, so they cannot drift.

## What the rules are

- **One statement, `SELECT` only.** `WITH … SELECT` is fine. Anything that
  writes, `PRAGMA`, `ATTACH`, or a second statement after a semicolon is
  refused before it reaches SQLite. This is a guard, not a suggestion.
- **The database is a cache, not the register.** It is rebuilt from the event
  log by `gamereg build`. If a query returns nothing for something the user just
  recorded, the build has not run — that's a stale cache, not a missing fact.
- **Exit code 2 with a message about `data/log.db`** means the vault has never
  built the `sqlite` target at all — usually a brand-new vault, or a query
  right after the first few events were ever recorded. Run
  `gamereg build --json` yourself, then retry the query. `build` never writes
  to the event log, never touches `amend`/`revoke`, and is idempotent — there
  is nothing here that needs asking first.

## The views, which is usually what you want

The tables are normalized; the views are the shapes questions actually come in.

| View | One row per | Columns |
|---|---|---|
| `v_finished` | finished run, flattened with its game | `run_id`, `game_id`, `title`, `slug`, `platform`, `form`, `mode`, `started_on`, `ended_on`, `completion_criteria`, `rating`, `difficulty`, `minutes`, `hours`, `hours_source`, `replay`, `developer`, `publisher`, `release_year`, `genres` |
| `v_by_year` | year of completion | `year`, `runs`, `hours`, `mean_rating` |
| `v_by_genre` | genre | `genre`, `runs`, `hours`, `mean_rating` |
| `v_sessions_by_day` | logical day played | `logical_day`, `sessions`, `hours` |

`v_finished` already joins the game, so the title, developer, release year and a
comma-joined `genres` are on the row. It carries both `minutes` and `hours` —
prefer `hours`, it is already rounded.

**Three of the four are already aggregated, and only `v_finished` is not.**
`v_by_year`, `v_by_genre` and `v_sessions_by_day` have done a `GROUP BY`
already, which has two consequences worth stating before you write the query:

- **They carry `hours`, never `minutes`.** Sum `hours`; `SUM(minutes)/60.0` is
  `no such column` here.
- **`COUNT(*)` counts the groups, not the things.** Over `v_sessions_by_day`
  that is *days*, not sessions; the session count is `SUM(sessions)`. Grouping
  an aggregate again is the one mistake here that returns a plausible number
  instead of an error.

Grouping days into weekdays, which is what that view is shaped for:

```sql
SELECT CAST(strftime('%w', logical_day) AS INTEGER) AS dow,
       COUNT(*) AS days, SUM(sessions) AS sessions, ROUND(SUM(hours), 1) AS hours
FROM v_sessions_by_day GROUP BY dow ORDER BY hours DESC
```

`%w` is 0 for Sunday. Name the days in the user's language when you narrate;
the database returns the number.

## Things that will trip you up

- **`ended_on` is not always a full date.** A run imported from memory may be
  `2011`, `2011-07` or `2011-07-14`. The first four characters are the year in
  every case; that is why `v_by_year` uses `SUBSTR(ended_on, 1, 4)`. Never
  compare it with a date function that assumes day precision.
- **A rating can be 11**, which means the game exceeded the scale. Do not clamp
  it to 10 and do not treat it as an error.
- **`minutes` includes stated baselines**, not only measured sessions —
  `hours_source` says which (`measured`, `stated`, `mixed`). When a total looks
  surprisingly round, that is why.
- **`platform` is nullable**, and null means nobody said, not "PC".
  `platform_raw` is what the user actually typed before canonicalization.
- **Runs, not games, are the unit.** A replay is a second run of the same game.
  `COUNT(*)` over runs is not how many games they played.
- **`v_finished` is finished runs only.** Abandoned runs are in `runs` with
  `outcome = 'abandoned'`; open runs have no `outcome` at all.

## Worked examples

Most recent RPG they rated well:

```sql
SELECT title, rating, ended_on FROM v_finished
WHERE genres LIKE '%RPG%' AND rating >= 8
ORDER BY ended_on DESC LIMIT 1
```

Hours per platform, everything on record — open, abandoned and finished:

```sql
SELECT platform, ROUND(SUM(minutes) / 60.0, 1) AS hours, COUNT(*) AS runs
FROM runs WHERE platform IS NOT NULL
GROUP BY platform ORDER BY hours DESC
```

**Read the question before picking the table.** "How many hours of Master
System have I got recorded" is every run; "how many hours of Master System have
I *finished*" is `v_finished`. The same sentence in `v_finished` returns a
smaller number with no indication that anything was left out, which is the one
way a wrong answer here looks right. Same query against finished runs only,
scoped to a year:

```sql
SELECT platform, ROUND(SUM(minutes) / 60.0, 1) AS hours
FROM v_finished WHERE ended_on >= '2026'
GROUP BY platform ORDER BY hours DESC
```

What is open right now — `gamereg open` answers this better, and without the
build having to be current. Prefer the command.

**There is no query here for an event id, and you should not write one.**
`amend` and `revoke` take event ids, and `gamereg open` and `gamereg status`
now carry them directly — `run_open_event_id`, `session_open_event_id`,
`last_checkin_id`. Reading a field costs nothing; reaching for the `events`
table costs a `--schema` call, a guessed column and a retry, and that is
exactly how it went every time it was tried.

## A year in review

You do not add up a year. The build already did: with the `stats` target
enabled, `obsidian/Stats.md` and `obsidian/reviews/<year>.md` hold the hours,
the sessions, the days played, what was finished and what was most played.
Answer from the database — `v_by_year`, and `v_sessions_by_day` for the
calendar. Narrate the rows; never compute a total in a message.

**You may offer the opening paragraph, and only offer it.** Same terms as a
verdict draft: propose, show, accept or refuse, with buttons. Read the year's
figures and that year's session notes, and write *the arc of the year* — what
changed between January and December — in their register, two paragraphs at
most. Review the year, not the games in it; each of those has its own verdict.

**You cannot file it, and you must say so plainly.** There is no `review`
command; you write no files. An accepted paragraph is text in the conversation
for the user to paste into `reviews/<year>.md`, anywhere outside the
`<!-- gamereg:... -->` markers, where the next build will leave it alone. Do
not imply it was saved, and do not offer to save it.
