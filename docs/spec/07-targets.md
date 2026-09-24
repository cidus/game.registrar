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
  /** The roadmap milestone it became available in; the CLI rejects the rest. */
  since: 0 | 1 | 3
  plan(state: VaultState, ctx: TargetContext): PlannedFile[]
}

type PlannedFile = {
  /** Vault-relative, forward slashes on every platform. Never escapes the root. */
  path: string
  /** The whole file, as it would be created from nothing. */
  content: string | Buffer
  policy: 'replace' | 'splice' | 'seed'
  /** Required by `splice`, meaningless otherwise. */
  parts?: { frontmatter: string | null; blocks: BlockContent[] }
}
```

`since` records when a target arrived, which is a fact about history and does not
move; [06-roadmap](06-roadmap.md) is the document that owns those numbers. A
spliced file is planned as the whole document it *would* be if the note did not
exist, plus the `parts` the writer splices into the note that does — planning
stays pure, and only the writer touches disk.

Rules, in force for every target ever added:

1. **A target reads the folded state and the config. Nothing else.** Not the
   filesystem, not its own previous output, not another target's output. This is
   what keeps the build a projection instead of a migration.
2. **A target performs no network I/O**, ever. Enrichment is a separate command
   and has already written its results into the log by the time `build` runs.
3. **A target is deterministic.** Same state in, same bytes out, in any locale,
   at any time of day, on any machine. There is **no exemption** — not for
   `sqlite`, not for a future target that wraps an external encoder. What varies
   between machines is how an artifact is *compared*, never whether it has to be
   reproducible: `data/log.db` is compared logically because SQLite's on-disk
   layout moves with the library version
   ([ADR 0013](../decisions/0013-sqlite-compared-logically.md)), while a second
   build on one machine is still compared byte for byte. See *Determinism* in
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
| `replace` | The file is generated in full. Deleting it costs nothing, and editing it loses the edit on the next build. | `obsidian/runs/*.md`, `obsidian/reviews/heatmap-<year>.svg`, every note and SVG under `quartz/content/`, CSV, SQLite, JSON, HTML |
| `splice` | Only the regions between `gamereg` markers are written. Everything else is preserved byte-identical. | `obsidian/games/*.md`, `obsidian/Game List.md`, `obsidian/Stats.md`, `obsidian/reviews/<year>.md` |
| `seed` | Written if absent. Never overwritten, never removed. | `obsidian/Game Database.base`, `quartz/content/Game Database.base`, `quartz/quartz.config.yaml` |

Two lines of that table are worth reading twice. The `stats` target **splices**
its two notes and writes its SVGs whole, because a heatmap has no outside and a
year in review does — the paragraph saying what the year felt like belongs to the
user. And `quartz` splices nothing at all: a site note has no hand-prose slot to
preserve, so everything in the content tree is `replace` except the seeded
`.base`.

`seed` is the exception to "every derived artifact is regenerated", and it is
deliberate. It covers exactly the files that are *configuration* rather than
data — a `.base` (see *Bases* below) and `quartz.config.yaml` — where the user's
edit is the point and regenerating over it would discard their work on every
build.

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

An unknown target name exits 2 and lists the valid ones, like any other enum. So
does a valid name this version does not yet ship — whether because the milestone
it belongs to has not arrived, or because it is a target of the current milestone
that has not landed yet and is listed in `UNBUILT_TARGETS`.

Both are refused **where the target is named** — by `init` and by the config
reader — rather than later at build time. A vault that has already written a
target into `build.targets` is a vault whose every build fails on something the
user was never warned about. The registry keeps its own refusal as a backstop.
See [ADR 0046](../decisions/0046-unbuilt-targets-list.md).

## Ownership and cleanup

`.gamereg/manifest.json`, gitignored, records which files each target wrote:

```json
{
  "schema": 1,
  "targets": {
    "csv": {
      "files": ["data/games.csv", "data/runs.csv", "data/sessions.csv"]
    },
    "obsidian": {
      "files": ["obsidian/Game List.md", "obsidian/games/celeste.md"],
      "seeds": ["obsidian/Game Database.base"]
    }
  }
}
```

Each target gets **two lists, not one**: `files`, which cleanup may remove, and
`seeds`, which it never may. Keeping them apart makes "a seed is never removed" a
property of the record rather than a condition someone has to remember; `seeds`
is omitted entirely for a target that has none. Paths are vault-relative with
forward slashes, and both lists are sorted, so the file is stable across builds.

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

This stays **one central whitelist** and is never split into per-target deletion
policies: `.obsidian/` survives a build precisely because it is not in the
manifest, and the failure modes are asymmetric — a wrong central rule deletes
nothing, a wrong per-target policy deletes somebody's vault configuration. See
[ADR 0030](../decisions/0030-deletion-is-one-manifest-whitelist.md).

The manifest is read back by the build, which looks like a violation of rule 1.
It is not a source of truth: it holds no state that the log does not already
imply, it is reconstructible by rebuilding, and no target may read it. It is a
caretaker's index, and only the writer touches it.

## The targets

| Target | Produces |
|---|---|
| `obsidian` | `obsidian/games/*.md`, `obsidian/runs/*.md`, `obsidian/Game List.md`, `obsidian/Game Database.base` |
| `csv` | `data/runs.csv`, `data/sessions.csv`, `data/games.csv`, `data/attachments.csv` |
| `sqlite` | `data/log.db` |
| `json` | `data/export.json` |
| `html` | `Games.html` |
| `stats` | `obsidian/Stats.md`, `obsidian/reviews/<year>.md`, `obsidian/reviews/heatmap-<year>.svg` |
| `quartz` | `quartz/content/games/*.md`, `quartz/content/runs/*.md`, `quartz/content/index.md`, `quartz/content/stats.md`, `quartz/content/reviews/<year>.md`, `quartz/content/reviews/heatmap-<year>.svg`, `quartz/content/Game Database.base`, `quartz/quartz.config.yaml` |

Two directories are written by the build and are **not** planned files, so they
appear in no manifest and are never cleanup candidates: `obsidian/assets` for the
`obsidian` target, and `quartz/content/assets` for `quartz` when
`images.publish` is on. Both are add-only mirrors of the vault's own `assets/`,
described under `obsidian` below.

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
vault root that never moves even if `build.targets` changes entirely.

The build mirrors each asset into `obsidian/assets` as a **hardlink**, never a
symlink — Obsidian on Linux does not traverse a symlink, and a hardlink is not a
link to follow but the file itself under a second name, so no indexer can decline
it. It costs no disk and the bytes cannot drift. Where a hardlink cannot be made
(a separate mount, a filesystem without them) the build copies instead. The
mirror only ever **adds**: nothing in gamereg deletes an ingested asset, a name
that exists already holds the right bytes since the path is the hash, and these
are not planned files, which is what keeps the pass clear of rule 1 and of the
manifest. A symlink left by an earlier version is replaced; anything else at that
path is left alone. See
[ADR 0016](../decisions/0016-obsidian-assets-are-hardlinks.md).

The important structural point is **one note per run**, in `runs/`, alongside the
one note per game in `games/`. The reason is mechanical: Bases produces one row
per file, and the row worth having is a playthrough, not a title. Without run
notes, a replay cannot appear as its own row in any query view — the same reason
`Game List.md` has always been one row per run.

### `csv`

Four flat files — one per level of the hierarchy, plus the photos filed against
them — RFC 4180, LF, UTF-8 without BOM, header row of English schema tokens.
Column names come from the SQLite schema of [04-derived](04-derived.md), so the
two targets never disagree about what a column means.

Four of that schema's nine tables are exported: `games`, `runs`, `sessions` and
`attachments`. `game_platforms`, `game_genres`, `breaks`, `aliases` and `events`
are join tables and a raw log, which a flat file has nowhere to put. `runs.csv`
also omits `runs.platform_raw`, an audit column rather than a spreadsheet one —
group by the canonicalized `platform`, audit in SQLite.

Sort order is fixed and documented per file, not incidental: `runs.csv` by
`started_on` then `run_id`; `sessions.csv` by `started_at` then `session_id`;
`games.csv` by `slug`; `attachments.csv` by `filed_at`, then `target`, then
`sha256`.

*Why it is worth having:* it opens in Numbers, Excel and Google Sheets, where
sorting, filtering and pivoting are things the user already knows how to do, and
it is the format every spreadsheet-shaped register in the world already speaks —
including the one this project replaces. It is also the cheapest possible exit
door, which matters for a tool whose pitch is that your data is yours.

### `sqlite`

Schema and views unchanged from [04-derived](04-derived.md). Rebuilt from
scratch on every build, never incrementally, because incremental is where a
cache starts lying. `gamereg query` reads it; nothing writes it but the build.

### `json`

`data/export.json`: `{ schema, games[], runs[], sessions[], attachments[] }` —
the same four tables `csv` flattens, with the same columns and the same sort
orders. For scripts, and for whatever exists in five years that reads JSON.

**Not a site feed, and not to be widened into one.** It mirrors the SQLite
tables column for column, which decides both directions: the cover is three flat
columns on `games`, so it is here too, while genres and platforms are
multi-valued and live in join tables the flattening drops, and `run.note` and the
verdict are prose a spreadsheet cell has nowhere to put. Adding the last four
would break what makes this useful to a spreadsheet and contradict 04-derived's
rule that the SQLite schema wins any disagreement. A generator that wants a
richer shape gets its own nested projection — see
[ADR 0058](../decisions/0058-astro-gets-a-projection.md). Nothing reads this file
to build the site today: `quartz` plans from folded state.

### `html`

One self-contained file. Data embedded as JSON, table sorted and filtered in
plain JavaScript, no build step, no CDN, no network at runtime. Opens from the
filesystem, works on a phone, survives being emailed to someone. It also inlines
**one** heatmap — the most recent year the log knows about, not every year, since
a single page is a snapshot rather than an archive.

This overlaps the Quartz site and does not replace it: the site is a
vault-wide, linked, publishable thing; this is one page that answers questions
about runs. Labels come from `i18n/`; the embedded data stays in schema tokens.

### `stats`

What the register knows about *time*, which no other target answers: a
calendar heatmap and a year in review.

- `obsidian/Stats.md` — totals, a row per year, a row per genre, and every
  year's heatmap.
- `obsidian/reviews/<year>.md` — one note per year: hours, sessions, days
  played, runs started, finished and abandoned, the longest session, the mean
  rating, the rating distribution, the most played titles, the runs finished,
  and the year's own heatmap.
- `obsidian/reviews/heatmap-<year>.svg` — the heatmap as a file.

**Which years exist comes from the log.** A year appears because a session
happened in it, never because a clock says it is now, and a year is always drawn
whole — January 1st to December 31st. A build in December and a build the
following January produce the same bytes. This is rule 3 restated, and it is
worth restating because "year in review" is the one artifact in this document
that reads like an invitation to call `Date.now()`. See
[ADR 0047](../decisions/0047-review-reads-no-clock.md).

**The renderers are shared, and the target decides only which files exist.**
`render/heatmap.ts` and `render/review.ts` are pure functions from folded state
to strings: the heatmap renderer returns SVG, and whether that string becomes a
file or is pasted inline is the caller's decision
([ADR 0049](../decisions/0049-heatmap-is-a-string.md)). `stats` writes the
heatmap as its own file and embeds it, `html` inlines the most recent year's, and
`quartz` writes the same notes `stats` does, under its own tree and with the
site's own wikilink shape (see the `quartz` section below). This is the same seam
`render/` and `targets/` already had — an emitter that does not know what file it
is going into — applied three times over.

Inline SVG rather than a chart library: no runtime dependency, no build step,
and it renders in Obsidian, in `Games.html`, on GitHub and on a published page.
It carries its own palette, including a `prefers-color-scheme` block, because a
file embedded as an image has no document to inherit a colour from. The embed is
a Markdown image with a path relative to the note's own folder — the one
spelling Obsidian, GitHub and a static site generator all resolve the same way.

`Stats.md` and each `reviews/<year>.md` are **spliced**; the SVGs are `replace`.
The numbers are the build's; the paragraph that says what the year *felt* like is
the user's, offered as a draft by the agent the way a verdict is (see
[05-agent](05-agent.md)) and accepted, edited or refused by them. It lands
outside the markers, where invariant 3 protects it from every later build. There
is no `review` command and no event: **the build never generates prose**. See
[ADR 0050](../decisions/0050-review-prose-has-no-command.md).

Two boundaries worth knowing, both of them the model being honest rather than
the target being lazy:

- **Hours in a year are measured hours.** A session has a logical day; stated
  hours from an `import` or from `--hours` belong to the run and to no day at
  all, so they count in the totals and in a game's own note, and not in a year.
  A register migrated from a spreadsheet therefore has years that look emptier
  than they were, which is true: nobody recorded those days. See
  [ADR 0048](../decisions/0048-year-hours-are-measured.md).
- **A day with a session still open is drawn at the lowest level**, not left
  blank. It has no measured minutes yet; something still happened there.

`stats` writes under `obsidian/`, the folder the user opens, even though it is
not the `obsidian` target — the two never plan the same path, and a stats note
is a note. A vault that declares `stats` without `obsidian` gets the folder with
those files in it and nothing else, which is odd but not wrong.

### `quartz`

The vault as a stranger reads it: the same notes, planned a second time
in the flavour Quartz consumes. An **ordinary target** — it plans its files from
the folded state like every other one, so rule 1 above holds for it with no
exception.

It does not read `obsidian/` and is never a second pass over what the other
targets wrote. See
[ADR 0029](../decisions/0029-quartz-plans-from-folded-state.md).

**gamereg never runs Quartz.** The target emits Quartz's *input*:

- `quartz/content/games/*.md` and `quartz/content/runs/*.md` — the notes again,
  in the site flavour.
- `quartz/content/index.md` — the consolidated table, as Quartz's landing page.
- `quartz/content/stats.md`, `quartz/content/reviews/<year>.md` and
  `quartz/content/reviews/heatmap-<year>.svg` — the same renderers `stats` calls.
- `quartz/content/Game Database.base` — the vault's seed, reused unchanged.
- `quartz/quartz.config.yaml` — a seeded Quartz configuration.

Everything but the two seeds is `replace`. How the site is built from there is
the user's business: by hand, from CI, from a cron job. **No workflow in this
repository builds it** — [ADR 0036](../decisions/0036-site-built-off-box-by-default.md)
records why the default is off-box, and
[docs/guides/publish-site.md](../guides/publish-site.md) has the paths that have
been run. The build spawns no subprocess, touches no network, and does not
require Quartz to be installed in order to build a vault.

The content tree mirrors the vault's own shape — `games/` and `runs/` — with
the consolidated table as `index.md`, which is Quartz's landing page. It is
`Game List.md` in the vault for the opposite reason: Obsidian shows a basename,
and a file called `index` says nothing in a quick switcher. Same block, same
renderer, two names because two readers
([ADR 0053](../decisions/0053-front-page-names.md)).

**The site carries what the log knows** — title, metadata, the cover when
`images.publish` allows it, the runs table, sessions, `note`s and `verdict`s —
and not prose typed by hand into a game note,
which lives only on disk, outside the markers, and never reaches the folded
state. That is a property rather than a shortfall: prose written in Obsidian
stays private by construction, and anything meant to be public is filed through
the CLI as a note or a verdict, which is D2 doing its job. The prose worth
publishing is already in the log.

The differences from the `obsidian` flavour are exactly **four booleans**, held
in one place (`render/flavour.ts`) and each stated as a property of the consumer
rather than a preference. The emitters read the booleans and never branch on the
flavour's name, which is what keeps the list from growing casually — see
[ADR 0051](../decisions/0051-flavour-is-a-record-of-answers.md).

| Flavour answer | Obsidian | Quartz |
|---|---|---|
| Site frontmatter (`description`, `draft`) | not written | written |
| Assets present in this tree | always | only when `images.publish` is on |
| Wikilinks name their folder | no (`[[hollow-knight]]`) | yes (`[[games/hollow-knight]]`) |
| A heading is left for hand-written prose | yes | no |

An asset embed resolves only if the file is in the tree being rendered, which on
the site is `images.publish`'s business — see [04-derived](04-derived.md)'s
*Publication* — and where it is off the note says so rather than embedding a
picture that is not there. A wikilink names its folder because Quartz resolves
one from the content root by default while Obsidian resolves it by shortest match
anywhere in the vault; naming the folder is the one spelling both accept, which
is what keeps the committed tree from depending on a config key gamereg seeds
once and never owns again ([ADR 0052](../decisions/0052-site-wikilinks-name-the-folder.md)).

The seeded `quartz.config.yaml` is Quartz's own `obsidian` template — the one
whose link resolution and Obsidian-flavored Markdown match what this target
emits — vendored rather than hand-written, because `theme` has no deep default
and a partial configuration is a broken one rather than a smaller one. Two things
are changed from the upstream template: the site's identity (title, base URL, no
analytics), and `@quartz-community/content-meta` set to `enabled: false`, since
the date and reading-time line it puts on every page does not fit a game
register. `@quartz-community/bases-page` is left enabled, which is what renders
the `.base` below. Like any seed the file is written once and never again, so
`npx quartz create` may replace it freely and `gamereg build --force` is the way
back. See [ADR 0054](../decisions/0054-vendored-quartz-config.md); verifying a
change to it means running Quartz, which gamereg never does.

**The site also carries `Stats.md` and a year in review — the same renderers,
reused through the flavour seam.** `render/heatmap.ts` and `render/review.ts`
don't know which consumer they're serving; `quartz` plans `content/stats.md`,
one `content/reviews/<year>.md` per year the log knows about, and each year's
heatmap as its own SVG, exactly as `stats` does for the vault, just written
into `quartz/content/` instead of `obsidian/` and linked with the site's
qualified wikilinks (`[[reviews/2026]]`, `[[games/hollow-knight]]`) instead of
Obsidian's bare ones. These are `replace` rather than `splice`, for the reason
the table above gives: a Quartz note has no hand-prose slot to preserve.
`index.md` is unchanged by this — the Stats page is reached through Quartz's own
content-tree explorer, not a link added to the table. Client-side filtering and
sorting, which `html` has, is deliberately not added here
([ADR 0060](../decisions/0060-site-without-client-side-filtering.md)).

**`quartz/content/Game Database.base` is the same seed the vault gets** —
`template('Game Database.base')`, reused byte-for-byte rather than forked — for
`@quartz-community/bases-page`, the Quartz plugin the seeded config leaves
enabled. Reusing it needed no renderer change and no fifth flavour field:
`file.hasTag("gamereg")` and the properties the `.base` reads — `status`,
`platform`, `genres`, `hours` and the rest — are written unconditionally in both
flavours by `render/run.ts`. The one exception is `cover`, which **is**
flavour-gated: on the site the run note carries it only when `images.publish` is
on, so the Shelf view's `image: cover` has nothing to point at otherwise, exactly
like every other embed on the site. See
[ADR 0061](../decisions/0061-site-reuses-the-base-seed.md).

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

**The shipped seed is
[templates/Game Database.base](../../templates/Game%20Database.base), and that
file is the authority.** It is not reproduced here: a copy in a spec drifts from
the template the moment either one moves. What the seed does is stable enough to
state:

- It filters to `file.inFolder("runs")` and `file.hasTag("gamereg")`, so every
  row is one playthrough.
- A `properties:` block renames three columns for display (`title` → Game,
  `completion_criteria` → Criteria, `hours_source` → Hours from).
- Five views: **Finished**, **Playing**, **By genre** (grouped on `genres`),
  **Dropped** (`status == "abandoned"`) and **Shelf**, a cards view over
  everything that is not `playing`.

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
  and that stays so: the register holds what you played, and there is no backlog
  view ([ADR 0007](../decisions/0007-no-backlog.md)).

Bases rewrites its own YAML when edited through the UI, so the seed is written in
the shape Obsidian itself produces rather than the shape the documentation
describes. A change to it is checked against Obsidian, not against the docs.

## Dataview

Not used, not generated, not supported: it is a community plugin, it embeds a
query language inside generated content, and Bases covers the same ground from
core. Nothing stops a user writing Dataview queries in their own prose — the
build never reads what is outside the markers, so it cannot break them. See
[ADR 0003](../decisions/0003-bases-not-dataview.md).
