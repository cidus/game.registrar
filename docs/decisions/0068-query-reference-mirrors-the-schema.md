# 0068. The query reference mirrors the SQL schema, held to it by a test

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Agent prompt

## Context

reference/query.md used to list the four views and no tables, on the grounds that --schema is the authority and a copy would drift. The agent, wanting a table no view covered, invented `FROM v_sessions` (next to the real v_sessions_by_day), and the exit 2 reached the user's chat. Withholding the list did not prevent a wrong name; it guaranteed a guess. Bytes: `query --schema --json` is 2,900 bytes against ~2,600 added to query.md, roughly a wash, plus a test and a maintenance obligation. What justifies it is where the bytes land: query.md is read only on question turns, which need column names by definition, unlike workspace/, paid every turn including 'Pausa'.

reference/query.md was given tables and columns after the agent invented `FROM v_sessions`, but the views kept their prose one-liners. The next hard question produced `SUM(minutes)` over v_sessions_by_day, a view that is already aggregated and carries `hours`. Same class and same cost (a visible exit 2), one release apart.

## Decision

List the tables (and columns) in reference/query.md, with a test comparing the list to SCHEMA_SQL. Two alternatives were declined because a wrong guess is not just a wasted call but a failed-exec warning on the user's screen: (a) always calling --schema first costs a round trip per question turn (the call is ~210ms, which is Node startup, against a ~10s median turn, so the cost is the model's extra step); (b) attaching table and view names to query's error envelope, as code 3 carries candidates[], is cheaper and cannot drift but only helps after the error. Prevention beat recovery.

When closing a gap like this, close it across the whole reference. The test now asks SQLite instead of parsing SQL: SCHEMA_SQL into an in-memory database, pragma_table_info back out, compared with the file. It follows the same 'ask the database, do not remember' rule the file gives the agent.

## Consequences

If query.md keeps growing, the arithmetic flips and --schema wins again. Reopen if wrong names keep reaching chat; the error-envelope change is then the first thing to build. The test mechanism described ('parses SCHEMA_SQL') was replaced by asking SQLite (see 'Fixing half a reference').

Views are listed with columns too; any schema change fails CI until query.md matches. The earlier item's 'parses SCHEMA_SQL' mechanism is superseded.

## Related

- [agent/skills/gamereg/reference/query.md](../../agent/skills/gamereg/reference/query.md)
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
- [src/db/schema.ts](../../src/db/schema.ts)
- [src/cli/commands/query.ts](../../src/cli/commands/query.ts)
