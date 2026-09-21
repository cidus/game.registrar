# Import a spreadsheet

Move a play history you kept in a spreadsheet into the register with
`gamereg import`, which files one past run per row. Use it when you have more
games than you want to enter one at a time with `gamereg past`.

## Before you start

- A register created with `gamereg init` ([Getting started](../getting-started.md)).
- The spreadsheet exported as a UTF-8 CSV file with a header row.
- A title and an end date for every row. Every other column is optional.
- A commit of the register, so the import lands as one change you can review.

## 1. Check the CSV

This guide uses the following `games.csv`:

```csv
Title,Finished,Started,Hours,Rating,Review
Chrono Trigger,2011-07,,30,10,Still the best time-travel plot in the medium.
Hollow Knight,2026-08-12,2026-05-03,42.3,9,
Celeste,2026,,,,
```

Before you export, check three things:

- **Hours use a decimal point.** `42.3` is accepted, but `42,3` fails that row.
  If your spreadsheet uses a decimal comma, reformat the column first.
- **Dates are a year, a month or a day:** `2011`, `2011-07` or `2011-07-14`.
  The run keeps that precision. A missing start date takes the end date.
- **Empty cells are fine.** An empty cell imports nothing for that field.
  Spaces at the start or end of a cell are ignored.

## 2. Write the mapping file

The mapping file tells `import` which column holds which field. Each key is a
gamereg field name, and each value is one of your column headers, exactly as
it appears in the header row. For the CSV above, `mapping.json` is:

```json
{
  "title": "Title",
  "ended": "Finished",
  "started": "Started",
  "hours": "Hours",
  "rating": "Rating",
  "verdict": "Review"
}
```

- `title` and `ended` are required. If either one is missing from the mapping,
  `import` exits with code 2 before it reads any row.
- The optional fields are `started`, `hours`, `rating`, `difficulty`,
  `criteria`, `outcome`, `platform`, `form`, `mode`, `note` and `verdict`. The
  [field table](../spec/02-cli.md#gamereg-import-filecsv---mapping-filejson)
  says what each one accepts.
- `rating` is a whole number from 0 to 11, or `none`. `difficulty`, `criteria`,
  `outcome`, `form` and `mode` take the same tokens as the flags of the same
  name on `gamereg past`.
- `note` is stored on the run. `verdict` is filed as the run's verdict, in an
  event of its own.
- A key that is not a field name is ignored without a warning, so check the
  spelling of every key.

## 3. Preview with a dry run

```bash
gamereg import games.csv --mapping mapping.json --dry-run
```

```text
Nothing was written.
3 rows imported.
The following events would have been appended:
  {"id":"01M2…","type":"game.create",…,"data":{…,"title":"Chrono Trigger",…}}
  {"id":"01M2…","type":"run.import",…}
  {"id":"01M2…","type":"run.verdict",…}
  …
```

Read the `game.create` lines. Each one is a game the import is about to create.
If a row's title should match a game already on record but the preview shows a
`game.create` for it, the title in the CSV is spelled differently from the
record. Either fix the cell, or teach the existing game that spelling before
you import:

```bash
gamereg alias "Hollow Knight" --add "Hollow Knight (Switch)"
```

> [!WARNING]
> Always run `--dry-run` first and read the titles it would create. As soon as
> the import runs, an unmatched title becomes a separate game, and removing it
> means revoking its events one at a time ([Fix mistakes](fix-mistakes.md)).

The preview also reports every row that would fail, in the same form as step 5,
and writes nothing.

## 4. Run the import

```bash
gamereg import games.csv --mapping mapping.json
```

```text
3 rows imported.
```

Each row becomes a `run.import` event: a closed run with stated hours. A row
that maps `verdict` also gets a `run.verdict` event, and a title not yet on
record gets a `game.create` event. The import never prompts and never uses the
network.

With `--json`, or when the output goes to a pipe, the result lists every row by
its line number in the CSV. The header is line 1.

```json
{
  "ok": true,
  "action": "run.import",
  "result": {
    "imported": [
      { "row": 2, "game_id": "01M2…", "run_id": "01M2…", "title": "Chrono Trigger" },
      { "row": 3, "game_id": "01M2…", "run_id": "01M2…", "title": "Hollow Knight" },
      { "row": 4, "game_id": "01M2…", "run_id": "01M2…", "title": "Celeste" }
    ],
    "failed": []
  },
  "events": ["01M2…", "…"]
}
```

Check the result, then regenerate the notes:

```bash
gamereg status
gamereg build
```

## 5. Handle rows that fail

A failed row does not stop the others. The rows that succeed are written, and
the command lists each failure and exits with code 1:

```text
2 rows failed. Everything else was written.
  row 2: Hours must be a positive number, not NaN.
  row 3: rating: 15 is out of range. Expected an integer from 0 to 11, or none.
```

In JSON the envelope has `"ok": false`, `"code": 1` and
`"error": "import_row_failed"`, with the same `result.imported` and
`result.failed` lists. With `--dry-run` the message is the same, but nothing is
written.

To import the rows that failed, copy the header row and only those rows into a
new CSV file, correct them, and import that file. Do not import the original
file again: every row that already succeeded would be filed a second time, as
a second run of the same game.

| Exit code | Meaning |
|---|---|
| 0 | Every row was imported. |
| 1 | Some rows failed. The rest were written. |
| 2 | No row was read: the CSV or the mapping could not be read, the mapping lacks `title` or `ended`, or `--mapping` was not given. |

## 6. Fetch metadata and covers

`import` creates each new game with a title and nothing else. To fill in
developers, genres, platforms and cover art for the new games, run:

```bash
gamereg enrich --missing --covers
```

This needs IGDB credentials, and selects only the games that have never been
enriched. It never prompts: it skips a title with several plausible catalog
matches, which you can then enrich by name. See
[Metadata and covers](metadata-and-covers.md).

## What imported runs look like

- **Hours are stated, not measured.** `gamereg status --json` reports
  `"hours_source": "stated"` for these runs, and `Game List.md` shows their
  hours as `30.0 (stated)`.
- **Runs have no sessions.** Only sessions carry a day. With the `stats` build
  target, a year that holds only imported runs shows no played days in its
  heatmap and gets no year-in-review note. The hours still count in the totals
  and in each game's note ([07-targets: stats](../spec/07-targets.md#stats)).
- **Platforms stay empty** unless you mapped `platform`. To set one later,
  amend the run's event ([Fix mistakes](fix-mistakes.md)).

## See also

- [02-cli: `gamereg import`](../spec/02-cli.md#gamereg-import-filecsv---mapping-filejson):
  the full field table and exit codes
- [02-cli: `gamereg past`](../spec/02-cli.md#gamereg-past-query--file-a-game-run-started-in-the-past):
  one past run at a time
- [Build outputs](build-outputs.md): the `stats` target and the other outputs
- [Fix mistakes](fix-mistakes.md): undoing an import row by row
