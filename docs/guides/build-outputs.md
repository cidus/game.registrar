# Choose and use build outputs

Decide what `gamereg build` generates, find the places where your own writing
survives a build, and query the register with SQL.

## Before you start

- A register with some recorded events ([Getting started](../getting-started.md)).
- Obsidian, if you want to read the notes there.

## 1. Choose targets

A target is one kind of output. Each generated file has a write policy, which
decides what a build does to it:

| Policy | What the build does |
|---|---|
| `replace` | Writes the whole file every time. An edit is lost at the next build. |
| `splice` | Writes only the regions between `gamereg` markers. Everything outside them is kept byte for byte. |
| `seed` | Writes the file only when it does not exist, then leaves it alone. Only `build --force` overwrites it. |

| Target | Files | Policy |
|---|---|---|
| `obsidian` | `obsidian/games/<slug>.md`, one per game | `splice` |
| | `obsidian/runs/<start date>-<slug>.md`, one per run | `replace` |
| | `obsidian/Game List.md`, one row per run (named for the locale) | `splice` |
| | `obsidian/Game Database.base`, an Obsidian Bases view | `seed` |
| `csv` | `data/games.csv`, `data/runs.csv`, `data/sessions.csv`, `data/attachments.csv` | `replace` |
| `sqlite` | `data/log.db`, which `gamereg query` reads | `replace` |
| `json` | `data/export.json`, the same rows as the CSV files | `replace` |
| `html` | `Games.html`, one self-contained page with a sortable, filterable table | `replace` |
| `stats` | `obsidian/Stats.md`: totals, a row per year, a row per genre, every year's heatmap (named for the locale) | `splice` |
| | `obsidian/reviews/<year>.md`, a year in review for each year with sessions | `splice` |
| | `obsidian/reviews/heatmap-<year>.svg` | `replace` |
| `quartz` | `quartz/content/**`: games, runs, `index.md` (the diary's most recent entries), `all-games.md`, `stats.md`, reviews, heatmaps and a diary per year | `replace` |
| | `quartz/content/Game Database.base` and `quartz/quartz.config.yaml` | `seed` |

Two of those names follow the vault's `locale`: under `pt-BR` they are
`Lista de Jogos.md` and `Estatísticas.md`. Changing `locale` renames them on
the next build, which discards anything written outside their markers. See
[ADR 0111](../decisions/0111-localized-surface-english-schema.md).

`build.csv.dir` sets the folder for the CSV files, `data` by default. The
`obsidian` target also links every stored photo into `obsidian/assets/`, so
embeds resolve inside the vault.

`data/runs.csv` carries the verdict and the closing note as columns, so a
spreadsheet or a script gets them without reading a note. A verdict often spans
paragraphs; the field is quoted, which every spreadsheet and every CSV library
reads correctly, and only a hand-rolled line split does not. See [07-targets](../spec/07-targets.md#the-targets)
for each target in detail.

Declare the targets in `gamereg.config.json`:

```json
{
  "build": {
    "targets": ["obsidian", "csv", "sqlite", "stats"]
  }
}
```

Alternatively, pass `--targets obsidian,csv,sqlite,stats` to `gamereg init`.
Without the key, the list is `["obsidian"]`. An unknown target name exits with
code 2 and lists the valid ones. See
[`build.targets`](../reference/configuration.md#buildtargets).

## 2. Run the build

```bash
gamereg build
```

```text
The register is in order: obsidian, csv, sqlite, stats, 14 files written.
```

The build regenerates every declared target from the log. Run it again with
nothing new recorded and it reports `0 files written`.

| Command | What it does |
|---|---|
| `gamereg build` | Builds every target in `build.targets`. |
| `gamereg build csv` | Builds only the named targets, which must already be declared. |
| `gamereg build --list` | Shows the declared targets and how many files each one owns. Writes nothing. |
| `gamereg build --dry-run` | Lists the files it would write, with their target and policy. Writes nothing. |
| `gamereg build --force` | Rewrites every file, seeds included. |

A target name narrows a build and never adds a target. Naming one that is not
in `build.targets` exits with code 2:

```text
"quartz" is not among this vault's build.targets: obsidian. The argument narrows a build; it never defines what the vault contains.
```

Other results:

- If one target fails, the others are still written. The build lists the
  failure and exits with code 1.
- If another build is writing the same register, the build exits with code 5.
  Run it again when the other one has finished.

> [!WARNING]
> `gamereg build --force` overwrites `Game Database.base` and
> `quartz/quartz.config.yaml` with the shipped versions, which discards any
> change you made to them.

### Remove a target

Delete the name from `build.targets` and run `gamereg build`. The build removes
the files that target wrote, as recorded in `.gamereg/manifest.json`, and says
how many:

```text
4 files no longer claimed by any target were removed.
```

The build never removes a file that is not in the manifest, so files you added
yourself are safe. If the manifest is missing, the build writes everything and
removes nothing. `gamereg doctor` then reports generated-looking files that no
target owns. See [07-targets: Ownership and cleanup](../spec/07-targets.md#ownership-and-cleanup).

## 3. Open the Obsidian vault

In Obsidian, choose **Open folder as vault** and pick the `obsidian/` folder
inside the register, not the register itself. The log, the secrets file and
`.gamereg/` then stay outside Obsidian's index.

Obsidian keeps its own settings in `obsidian/.obsidian/`. That folder is not in
the manifest, so no build ever touches it.

## 4. Write your own text in the right place

| File | Does your text survive a build? | Where to write |
|---|---|---|
| `obsidian/games/*.md` | Yes | Outside the markers, for example under `## Notes`. |
| `obsidian/Game List.md` | Yes | Outside the markers. |
| `obsidian/Stats.md`, `obsidian/reviews/<year>.md` | Yes | Outside the markers, for example a paragraph about the year. |
| `Game Database.base`, `quartz/quartz.config.yaml` | Yes, until `build --force` | Anywhere in the file. |
| `obsidian/runs/*.md` | No, the file is rewritten | Use `gamereg end --note`, `gamereg finish --note` and `gamereg verdict`. |
| `quartz/content/**/*.md` | No, the files are rewritten | Nowhere. |
| CSV, JSON, HTML, SQLite, heatmap SVG | No, the files are rewritten | Nowhere. |

A marked region looks like this. Do not edit between the two comments:

```markdown
<!-- gamereg:begin block=runs -->
…generated…
<!-- gamereg:end block=runs -->
```

A marker without its partner, or one nested inside another pair, is an error:
the build reports it and does not write that file. See
[04-derived: Marker protocol](../spec/04-derived.md#marker-protocol).

When a run note holds text of yours, `gamereg doctor` warns before the next
build removes it:

```text
obsidian/runs/2011-07-chrono-trigger.md: a run note carries text outside its markers ("my own prose"). The next build will lose it.
```

Text you write in a game note stays on your disk. The `quartz` target builds the
site from the log, never from your notes, so that text never reaches a
published site.

## 5. Add stats

Add `stats` to `build.targets` and run `gamereg build`. There is no
`gamereg stats` command. Stats are a build target.

- `obsidian/Stats.md` holds the totals, a row per year, a row per genre and each
  year's calendar heatmap.
- `obsidian/reviews/<year>.md` is written for each year that has at least one
  session. It holds that year's hours, sessions, days played, runs, ratings,
  most played titles and heatmap.
- A year counts only measured sessions. Hours from `past` or `import` count in
  the totals and in the game's note, but not in any year's days, so a year
  holding only imported runs gets no review note.

See [04-derived: Heatmap and year in review](../spec/04-derived.md#heatmap-and-year-in-review).

## 6. Query the register with SQL

`gamereg query` reads `data/log.db`, which only the `sqlite` target writes.
Declare `sqlite` and run `gamereg build` first. Otherwise the query exits with
code 2:

```text
data/log.db does not exist yet. Declare "sqlite" in build.targets and run gamereg build.
```

List the tables, views and columns:

```bash
gamereg query --schema
```

Run a query:

```bash
gamereg query "SELECT title, hours FROM v_finished ORDER BY rating DESC"
```

```text
2 rows:
[
  {
    "title": "Chrono Trigger",
    "hours": 30
  },
  {
    "title": "Hollow Knight",
    "hours": 9
  }
]
```

- Only a single read-only `SELECT`, or `WITH … SELECT`, is accepted. Anything
  else exits with code 2.
- The views `v_finished`, `v_by_year`, `v_by_genre` and `v_sessions_by_day`
  already compute hours. The `games` table has no hours column; use a view, or
  `minutes` on `runs` and `sessions`.
- The database is rebuilt whole by every build, and nothing else writes to it.
  After you record something, run `gamereg build` before you query.
- `runs.verdict` holds the latest verdict filed for a run and `runs.note` the
  line it was closed with, so `SELECT title, verdict FROM runs JOIN games USING
  (game_id)` answers "what did I say about it" without opening a note. Both are
  null when nothing was written.
- At a terminal, the rows print as JSON after a count. With `--json`, or in a
  pipe, they arrive inside the usual envelope.

See [02-cli: `gamereg query`](../spec/02-cli.md#gamereg-query-sql) and the table
definitions in [04-derived: SQLite](../spec/04-derived.md#sqlite).

## 7. Generate input for a site

The `quartz` target writes the register as input for
[Quartz](https://quartz.jzhao.xyz): pages under `quartz/content/` and a seeded
`quartz/quartz.config.yaml`. gamereg never runs Quartz itself. Building and
hosting the site is covered in [Publish a site](publish-site.md). Photos and
covers are copied into the site only when `images.publish` is `true`
([configuration reference](../reference/configuration.md#imagespublish)).

## See also

- [02-cli: `gamereg build`](../spec/02-cli.md#gamereg-build-target---force---list)
- [07-targets](../spec/07-targets.md): the target contract and write policies
- [04-derived](../spec/04-derived.md): every generated artifact
- [Configuration reference: `build`](../reference/configuration.md#build)
- [Fix mistakes](fix-mistakes.md): `gamereg doctor`
