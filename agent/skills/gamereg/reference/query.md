# Answering questions with SQL

```
gamereg query "SELECT title, hours FROM v_finished ORDER BY rating DESC LIMIT 5" --json
```

The database does the arithmetic. You write the SQL and narrate the rows — you
never add up hours, average a rating, or count runs yourself. A number you
computed is a number that can be wrong; a number the database computed cannot.

## Find out what there is before you guess

```
gamereg query --schema --json
```

Tables and views with their columns. Call this rather than remembering — the
schema is versioned in the repository, this file is not the authority on it, and
a column that was renamed will not announce itself.

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

| View | One row per | Use it for |
|---|---|---|
| `v_finished` | finished run, flattened with its game | "what did I finish", ratings, hours, genres, platform |
| `v_by_year` | year of completion | "how much did I play in 2026" |
| `v_by_genre` | genre | "how many hours on RPGs" |
| `v_sessions_by_day` | logical day played | streaks, calendars, "did I play yesterday" |

`v_finished` already joins the game, so the title, developer, release year and a
comma-joined `genres` are on the row. It carries both `minutes` and `hours` —
prefer `hours`, it is already rounded.

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

Hours per platform, this year:

```sql
SELECT platform, ROUND(SUM(minutes) / 60.0, 1) AS hours
FROM v_finished WHERE ended_on >= '2026'
GROUP BY platform ORDER BY hours DESC
```

What is open right now — `gamereg open` answers this better, and without the
build having to be current. Prefer the command.
