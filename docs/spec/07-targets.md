# 07 — Build Targets

`gamereg build` does not produce one format. It produces the set of formats the
vault declares, from a single fold of the log, in one pass.

## Why more than Markdown

A Markdown table is static. Obsidian will never sort or filter it, and that is
not a defect of the note — it is what a table in a text file is. The questions
worth asking of a register ("which RPGs did I finish in 2026", "what did I rate
above 8 on Switch", "sort by hours descending") need either a query layer over
the notes or a different artifact entirely.

Both exist and neither is expensive, so the build emits both. What changes is
that the emitters stop being one function and become a **registry**.

## The contract

A target is a pure function from folded state to a list of files.

```ts
type Target = {
  /** Stable identifier. Also the CLI argument and the config key. */
  name: string
  /** Phase in which it becomes available; the CLI rejects the rest. */
  since: 0 | 1 | 3
  plan(state: VaultState, ctx: TargetContext): PlannedFile[]
}

type PlannedFile = {
  /** Vault-relative. Never escapes the vault root. */
  path: string
  content: string | Buffer
  policy: 'replace' | 'splice' | 'seed'
}
```

Rules, in force for every target ever added:

1. **A target reads the folded state and the config. Nothing else.** Not the
   filesystem, not its own previous output, not another target's output. This is
   what keeps the build a projection instead of a migration.
2. **A target performs no network I/O**, in any phase. Enrichment is a separate
   command and has already written its results into the log by the time `build`
   runs.
3. **A target is deterministic.** Same state in, same bytes out, in any locale,
   at any time of day, on any machine — with one documented exception, the
   SQLite library version underneath `sqlite`. See *Determinism* in
   [04-derived](04-derived.md) — the rules there bind every target, not just the
   Markdown one.
4. **A failing target does not take the others down.** The Markdown vault must
   not go stale because SQLite failed to compile. Failures are collected,
   reported, and the process exits 1 having written everything that did work.
5. **Every target ships a golden fixture.** `example-vault/` holds the expected
   output of every enabled target, and the idempotency test runs across all of
   them.

### Write policies

The policy is a property of the artifact, not of the target, and there are
exactly three because there are exactly three kinds of file in the vault.

| Policy | Meaning | Used by |
|---|---|---|
| `replace` | The file is generated in full. Deleting it costs nothing, and editing it loses the edit on the next build. | `obsidian/runs/*.md`, CSV, SQLite, JSON, HTML |
| `splice` | Only the regions between `gamereg` markers are written. Everything else is preserved byte-identical. | `obsidian/games/*.md`, `obsidian/Game List.md` |
| `seed` | Written if absent. Never overwritten, never removed. | `*.base` |

`seed` is the exception to "every derived artifact is regenerated", and it is
deliberate — see *Bases* below.

## Declaring targets

Which targets exist is a property of **the vault**, not of the last command
typed:

```jsonc
// gamereg.config.json
{
  "build": {
    "targets": ["obsidian", "csv"],
    "csv": { "dir": "data" }
  }
}
```

`gamereg build` builds everything in `targets`. `gamereg build csv` builds a
subset, as a convenience while iterating. **The argument narrows a build; it
never defines what the vault contains.** Without this, invariant 4 of
[00-architecture](00-architecture.md) — delete every derived artifact, rebuild,
lose nothing — becomes a statement about shell history, which is no statement at
all.

Omitting `build.targets` means `["obsidian"]`, so a vault that has never heard of
this key still builds the notes and the table.

An unknown target name exits 2 and lists the valid ones, like any other enum. A
target from a later phase exits 2 saying so.

## Ownership and cleanup

`.gamereg/manifest.json`, gitignored, records which files each target wrote:

```json
{ "schema": 1, "targets": { "csv": { "files": ["data/runs.csv", "data/sessions.csv"] } } }
```

On each build, a file previously owned by a target and no longer planned by it is
**removed**. That is how disabling `csv` cleans up after itself, how renaming a
game stops orphaning its old note, and how a run note follows its own name when
the start date is amended. One mechanism, no special cases per artifact.

Three guardrails, because this is the only part of the build that deletes:

- **A file absent from the manifest is never removed**, whatever it looks like.
  The build does not guess ownership from a filename pattern.
- **`seed` files are never removed.** Once a `.base` exists it is the user's.
- A missing or unreadable manifest is not an error: the build writes everything
  and creates a new one, skipping cleanup for that run. `gamereg doctor` reports
  the resulting orphans rather than the build acting on a guess.

The manifest is read back by the build, which looks like a violation of rule 1.
It is not a source of truth: it holds no state that the log does not already
imply, it is reconstructible by rebuilding, and no target may read it. It is a
caretaker's index, and only the writer touches it.

## The targets

| Target | Produces | Phase |
|---|---|---|
| `obsidian` | `obsidian/games/*.md`, `obsidian/runs/*.md`, `obsidian/Game List.md`, `obsidian/Game Database.base` | 0 |
| `csv` | `data/runs.csv`, `data/sessions.csv`, `data/games.csv` | 0 |
| `sqlite` | `data/log.db` | 1 |
| `json` | `data/export.json` | 1 |
| `html` | `Games.html` | 1 |
| `site` | `site/` via Quartz | 3 |

### `obsidian`

The vault as Obsidian reads it: notes, the consolidated table, and the Bases that
make them queryable. Detailed in [04-derived](04-derived.md).

Everything this target writes lives under `obsidian/` — that folder, not the
vault root, is what a user opens as their Obsidian vault, so `data/`,
`gamereg.secrets.json` and `.gamereg/` never show up in the file explorer or get
indexed. Every path below (`games/`, `runs/`, `Game List.md`, `Game Database.base`,
`file.inFolder("runs")`) is written relative to `obsidian/`, exactly as if it
were the vault root — because from inside Obsidian, once it is, it is.

The one thing that lives outside `obsidian/` on purpose is `assets/`: image
ingestion (`--photo`) writes there directly, independent of any build target
(00-architecture.md, *Two repositories*), so it has to stay reachable from a
vault root that never moves even if `build.targets` changes entirely. The
build keeps `obsidian/assets` as a symlink to `../assets` — created once,
left alone forever after, so an embed (`![[assets/<sha>...]]`) resolves
without `render/note.ts` needing to know it is one folder deeper than it
used to be.

The important structural point is **one note per run**, in `runs/`, alongside the
one note per game in `games/`. The reason is mechanical: Bases produces one row
per file, and the row worth having is a playthrough, not a title. Without run
notes, a replay cannot appear as its own row in any query view — the same reason
`Game List.md` has always been one row per run.

### `csv`

Three flat files, one per level of the hierarchy, RFC 4180, LF, UTF-8 without
BOM, header row of English schema tokens. Columns mirror the SQLite tables
exactly, so the two targets never disagree about what a column means.

Sort order is fixed and documented per file, not incidental: `runs.csv` by
`started_on` then `run_id`; `sessions.csv` by `started_at` then `session_id`;
`games.csv` by `slug`.

*Why it is worth its ~50 lines:* it opens in Numbers, Excel and Google Sheets,
where sorting, filtering and pivoting are things the user already knows how to
do, and it is the format every spreadsheet-shaped register in the world already
speaks — including the one this project replaces. It is also the cheapest
possible exit door, which matters for a tool whose pitch is that your data is
yours.

### `sqlite`

Schema and views unchanged from [04-derived](04-derived.md). Rebuilt from
scratch on every build, never incrementally, because incremental is where a
cache starts lying. `gamereg query` reads it; nothing writes it but the build.

### `json`

`data/export.json`: `{ schema, games[], runs[], sessions[] }`, the same shape the
CSV flattens. For the site, for scripts, and for whatever exists in five years
that reads JSON — which is everything.

### `html`

One self-contained file. Data embedded as JSON, table sorted and filtered in
plain JavaScript, no build step, no CDN, no network at runtime. Opens from the
filesystem, works on a phone, survives being emailed to someone.

This overlaps the Quartz site of phase 3 and does not replace it: the site is a
vault-wide, linked, publishable thing; this is one page that answers questions
about runs. Labels come from `i18n/`; the embedded data stays in schema tokens.

### `site`

Phase 3. Runs Quartz over the finished vault, which means it is the one target
that reads what the others wrote — and therefore the one that always runs last,
in a second pass, outside the contract above.

## Bases

`.base` files are YAML, live in the vault, and are read by a core Obsidian
plugin — no community plugin, nothing to install, and a plain-text artifact that
belongs in git.

The build seeds `Game Database.base` and does not touch it again. **A base is
configuration, not derived data:** the moment a user reorders a column or adds a
view through the Obsidian UI, Obsidian rewrites the file, and a build that
regenerated it would silently discard that work every time. Regenerating a note
is safe because prose lives outside the markers; a `.base` has no outside.

`gamereg build --force` overwrites seeds. It is the only path that does, and it
is how you go back to the shipped default after experimenting.

The seed queries `runs/`, one row per playthrough:

```yaml
filters:
  and:
    - file.inFolder("runs")
    - file.hasTag("gamereg")
views:
  - type: table
    name: Finished
    filters:
      and:
        - 'status == "finished"'
    order: [title, platform, ended_on, hours, rating, difficulty, completion_criteria]
    sort:
      - property: ended_on
        direction: DESC
    summaries:
      hours: Sum
  - type: table
    name: Playing
    filters:
      and:
        - 'status == "playing"'
    order: [title, platform, started_on, hours]
  - type: table
    name: By genre
    groupBy:
      property: genres
      direction: ASC
    order: [title, rating, hours]
  - type: cards
    name: Shelf
    filters:
      and:
        - 'status != "playing"'
    image: cover
    order: [title, platform, rating]
```

`image: cover` is the one view-level setting a `.base` file needs for a cards
gallery — cards always show the file name as the card's own title regardless
of `order` (a known Obsidian limitation, not a `gamereg` choice: nothing in
Bases lets a card's header show anything but the filename), so `title` in
`order` is what makes the game's actual name visible on the card at all.

Two consequences of Bases having no joins, both already handled by the shape of
the run note:

- Game-level fields the user will want to filter by — `genres`, `developer`,
  `release_year`, `cover` — are **denormalized onto the run note**. Duplication
  in derived output is free; it regenerates.
- A game with no runs at all (`status: unplayed`) has no row in a run-level base,
  and that stays so: [06-roadmap](06-roadmap.md) decided against a backlog view.
  The register holds what you played.

Bases rewrites its own YAML when edited through the UI. The seed above is
therefore written in the shape Obsidian itself produces, and the implementation
should verify it against a base edited once through the UI rather than against
the documentation alone.

## Dataview

Not used, not generated, not supported. It is a community plugin, it embeds a
query language inside generated content, and Bases now covers the same ground
from core. Nothing stops a user writing Dataview queries in their own prose — the
build never reads what is outside the markers, so it cannot break them.
