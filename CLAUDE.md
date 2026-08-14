# CLAUDE.md

Briefing for a coding session on this repository.

## What this is

`gamereg` — a CLI that records video game playthroughs into an append-only event
log, and regenerates Markdown notes, run notes, a consolidated table and a set of
other artifacts from that log. An optional chat agent sits on top and does
nothing but invoke the CLI.

**Read `docs/spec/` before writing code.** Start with `00-architecture.md`
(decisions and invariants), then `01-model.md` (the data model). Those two
constrain everything else. For anything touching `build`, add `07-targets.md` —
the build is a registry of targets, not a single emitter.

## Current state

**Phase 0 is done.** Event log with `amend`/`revoke`, fold, duration arithmetic
with breaks and the logical-day rule, local resolution with alias learning, the
recording and query commands, `verdict`, `init`, `doctor`, and `build` as a
target registry with a manifest and ownership-based cleanup. Two targets ship:
`obsidian` (game notes, run notes, `Game List.md`, seeded `Game Database.base`)
and `csv`. `example-vault/` is the golden fixture for both.

**Phase 1 is done.** `CURRENT_PHASE` in `core/vocab.ts` is `1`.
Implemented and tested: provider credentials, `providers/igdb.ts` behind a
common `Provider` interface (RAWG was implemented alongside it as a fallback,
found offline in 2026-08 — `api.rawg.io`/`rawg.io` both timed out — and
removed entirely rather than kept unmaintained; `PROVIDER_CREDENTIAL_FIELDS`
in `core/secrets.ts` and `KNOWN_PROVIDERS` in `cli/commands/enrich.ts` are
the two places a future second provider would join, the same shape RAWG
used), `enrich` (including provider ambiguity handling — a menu or exit 3 +
`candidates[]`, `--match <ref>` to re-invoke, platform-aware
narrowing/auto-resolution from the game's recorded runs, and a literal
`<query>` — when given — driving the provider search directly instead of
the resolved game's stored title, so a retyped query is the retry path for
a poor first search), resolution step 6 in `gamereg search` (never in a
write command — see non-negotiable 4), the `sqlite`/`json`/`html` targets,
`query`, `import`, the image ingestion *pipeline* (`src/images/ingest.ts` +
`exif.ts` — EXIF read then stripped, normalize, hash, write to
`assets/<sha[0:2]>/<sha>.webp`), its **CLI surface**, **provider cover
download** and the **platform vocabulary** (all below). `npm test` runs 344
tests (`node --test`, no framework, no network). `npm run test:live`
(opt-in, real IGDB calls, skips cleanly with no credentials — see Testing
strategy below) adds 8 more; run it whenever you touch provider matching.

Tagged `v0.1.0`, `v0.1.1`, `v0.1.2`. `package.json` reads `0.1.3` — still
hardening phase 1 (see *Obsidian layout, Bases fixes, and provider cleanup*
below for what shipped in `v0.1.2`); phase 2 has not started. See Versioning
below for what a patch on an already-tagged phase does to the number.

### Image ingestion's CLI surface, as built

Shipped this round. `fold.ts` already handled `attachment.add`, `game.cover`
and inline `attachments[]` on any event since phase 0; this round was CLI and
render work on top of that, not model work.

- **`--photo <path>` / `--caption <text>` / `--kind <k>` / `--as-cover`** are
  on `start`, `end`, `finish`, `drop` and `past`. `--photo` and `--caption`
  are both repeatable, and `--caption` captions the `--photo` immediately
  before it — `cli/attachments.ts`'s `photoSpecsFrom()` walks the
  invocation's own raw argv to pair them, because Commander's own
  accumulation collects repeated options into independent arrays and loses
  which caption went with which photo. `--kind` is a single value that
  applies to every photo in that invocation, not paired per-photo — the CLI
  doc marks only `--photo`/`--caption` as repeatable.
- **Each photo lands on that command's own terminal event**: `session.open`
  for `start`, `session.close` for `end`, `run.close` for `finish`/`drop`,
  `run.import` for `past` — never on the incidental `session.close` that
  `finish`/`drop` auto-close on the way to `run.close`.
- **`gamereg attach <target> --photo ...`** resolves `<target>` as an event id
  first, a game query otherwise, per `02-cli.md`.
- **`gamereg cover <query>`** takes exactly one of `--photo` (ingest and
  promote), `--from <hash>` (promote an attachment already on this game's
  timeline — validated against it, not accepted blind) or `--reset` (appends
  `game.cover` with `source: provider` and nothing else; it does not restore
  a specific prior URL, it just un-sets the user override so the next
  `enrich --covers` can set one again).
- **`core/fold.ts` gained `attachmentsOfGame()` and `gameOfEvent()`.**
  `state.attachments` is keyed by *target* (an event id, or a game id) with
  no notion of which game an event belongs to; these walk the events once to
  resolve that ownership — the same thing `gameOfSession` does for one
  session — and `attachmentsOfGame` de-duplicates by hash, chronological,
  oldest first.
- **The game note's header embeds the cover** (`![[assets/<sha[0:2]>/<sha>.webp]]`,
  above the existing text line) when `game.cover.sha256` is set. That is
  every `source: user` cover, and, since the v0.1.1 patch below, every
  `source: provider` cover too — `--covers` downloads it, not only its URL.
- **The `gallery` block** is new in `render/note.ts`'s `BLOCK_ORDER` and
  `blocksOf()`, rendered from `attachmentsOfGame()`. Every attachment is
  normalized to WebP by the pipeline, so the embed path is always
  `assets/<sha[0:2]>/<sha>.webp` — no `ext` needs to travel with a cover
  pointer.
- **`example-vault/` was not extended** with a photo fixture this round —
  the golden-file risk (a real, deterministically-hashed image checked into
  the fixture) outweighed the benefit given `test/attachments.test.ts` and
  `test/photo-cli.test.ts` already cover the fold ownership logic, the
  render output and the full CLI surface end to end. Worth adding later if a
  golden test for the gallery block specifically becomes valuable.

### Provider cover download — v0.1.1 patch

`docs/spec/06-roadmap.md`'s own phase 1 line item — "`enrich`, cover download
via `sharp`" — had never actually been built: `--covers` stored only the
provider's raw URL, and (per the previous section) nothing rendered for a
URL-only cover. This patch closes that gap; it is a bug fix within phase 1,
not phase 2 work, hence `v0.1.1` rather than folding into `v0.2.0`.

- **`images/ingest.ts` is now two entry points over one shared pipeline.**
  `ingestBuffer()` (normalize, hash, write) is what both `ingestImage()`
  (reads a local file — unchanged) and the new `ingestUrl()` (fetches a URL)
  call. `ingestUrl` never throws: a network error, a non-`ok` response, or
  bytes `sharp` cannot parse all resolve to `null`, matching 02-cli.md's
  "failure here never blocks recording" for `enrich` as a whole.
- **`fetchImpl` is injected**, default global `fetch`, threaded from
  `enrichGame`/`applyDetail` down to `ingestUrl` — the same pattern
  `providers/igdb.ts` already uses, so unit tests mock at this boundary
  instead of opening a socket (`test/enrich-fallback.test.ts`).
- **`game.enrich`'s `cover` field changes shape**, from a bare URL string to
  `{ url, sha256? }`. `fold.ts` reads *both* shapes forever — an old
  string-only event still folds exactly as it always did — because the log
  is append-only and nothing rewrites a line already written (non-negotiable
  1). No schema bump: this is additive, tolerant parsing, not a breaking
  change.
- **A `source: user` cover is never even fetched.** `applyDetail` checks
  `game.cover?.source === 'user'` before calling `ingestUrl` — the fold would
  discard the result anyway (01-model.md "Cover precedence"), so skipping the
  network call is free correctness, not an optimization worth re-litigating.
- **Verified against real IGDB** (credentials in `example-vault/gamereg.secrets.json`,
  gitignored) in addition to the mocked unit tests: `enrich --match --covers`
  against Hollow Knight's real catalog entry downloads, normalizes, hashes,
  writes `assets/`, and the header embed renders it. Not a committed test —
  a one-off manual check, since `npm run test:live` intentionally stays
  narrow (see its file comment).

### Obsidian layout, Bases fixes, and provider cleanup — v0.1.2

Shipped across several rounds within `v0.1.2` — search platform ranking,
`start --past-hours`/`past`'s stated baseline, and the amend fix landed
first under that version number too; see the `v0.1.2` tag/release for the
complete list. All of it is a patch on phase 1, not phase 2 (chat and
voice) — see Versioning below.

Everything the `obsidian` target writes now lives under `obsidian/`, not the
vault root — `obsidian/games/`, `obsidian/runs/`, `obsidian/Game List.md`,
`obsidian/Game Database.base`. That folder, not the repo root, is what gets
opened as the Obsidian vault, so `data/`, `gamereg.secrets.json` and
`.gamereg/` stay out of it. `assets/` itself still lives at the vault
root — written directly by image ingestion, independent of any target —
and `gamereg build` keeps `obsidian/assets` as a symlink to `../assets`
(`targets/obsidian.ts`'s `ensureAssetsLink`, called once from `build.ts`
whenever `obsidian` is among the targets built) so `![[assets/<sha>...]]`
still resolves. Paths *inside* the Bases seed (`file.inFolder("runs")`) did
not need to change — they were already relative to what is now
`obsidian/`, not the vault root. See 07-targets.md's `obsidian` section.

- **`Games.md`/`Games.base` renamed to `Game List.md`/`Game Database.base`**
  — both used to display as bare "Games" in Obsidian's file explorer and
  quick switcher, indistinguishable at a glance. `templates/Games.base` was
  renamed to `templates/Game Database.base` to match.
- **The `By genre` view in `Game Database.base` had a real bug**, found live
  in Obsidian for Mac: `groupBy` needs both `property` *and* `direction` —
  every real example found while researching this (including kepano's own
  vault, `kepano/kepano-obsidian`) always pairs them, and omitting
  `direction` failed to parse the whole file, not just that view.
- **Bases' cards view always shows the file name as a card's own title**,
  with no YAML way to override it — confirmed against the official
  `obsidianmd/obsidian-help` source and kepano's own `.base` files, not just
  inference. The `image` property (`image: cover`) is a genuine, distinct
  view-level key, found in `kepano/kepano-obsidian`'s
  `Templates/Bases/Attachments.base` — not something inferred from a
  property's shape in `order:`.
- **Run notes are named `<started_on>-<slug>.md`, date first**, not
  `<slug>-<started_on>.md` — a plain filename sort in the file explorer is
  now chronological. `render/run.ts`'s `runNoteNames()` is the one place
  that mattered; `render/note.ts`'s wikilinks and `obsidian.ts`'s
  `PlannedFile.path` both already called it.
- **Run notes carry a denormalized `cover` property**
  (`render/assets.ts`'s `assetPath()`, shared with the game note to avoid a
  circular import between `note.ts` and `run.ts`), populated only once a
  game has a locally-ingested cover. It's what `Game Database.base`'s Shelf
  view points `image:` at — the game note's own header embed and
  `Game List.md`'s reduced-width Cover column follow the same rule.
- **Game notes carry an Obsidian `aliases: [title]`** — the filename is the
  slug (filesystem-safe, not pretty), so this is what lets the quick
  switcher find a note by the title someone actually types.
- **RAWG removed entirely** (`src/providers/rawg.ts` deleted). It had been
  offline since before this was first noted here — `api.rawg.io` and
  `rawg.io` both timed out — and was never going to receive further
  updates. `PROVIDER_CREDENTIAL_FIELDS` (`core/secrets.ts`) and
  `KNOWN_PROVIDERS` (`cli/commands/enrich.ts`) now list only `igdb`; that's
  where a future second provider would join, the same shape RAWG used.

### The platform vocabulary, as built

Shipped this round; `docs/spec/02-cli.md` ("Platform vocabulary" and
"Platform, when a run closes") is the spec, and `01-model.md`,
`03-resolution.md`, `04-derived.md` and `05-agent.md` were updated to match.
What a future session most needs to know:

- **`platform` is nullable and free text.** `start` no longer prompts and
  `error.platform_required` no longer exists — a run records what is known and
  nothing more. Nothing anywhere rejects a platform value; the table
  canonicalizes spellings and orders what gets offered, and that is all.
- **`core/platforms.ts`** holds the built-in table (names, synonyms, *and the
  providers' own spellings*, which is what makes the catalog intersection work
  without provider platform ids) plus `canonicalPlatform()`, `platformGroups()`
  and `addPlatform()`. The names there are **data, not interface text** — the
  one deliberate exception to "no hardcoded English in `src/`". Do not move it
  to `i18n/`.
- **Canonicalization runs at two boundaries**: on input, before an event is
  staged; and on read, in `canonicalizeState()` at the top of `planBuild`
  (`targets/build.ts`). The read pass is what fixes history retroactively — a
  synonym added today re-renders runs from years ago with no `event.amend` and
  no line rewritten. `fold` stays pure and never sees the table; `sqlite`
  stores both `platform` and `platform_raw`.
- **The late fill lives in `cli/platform.ts`**, called by `end`/`finish`/`drop`
  (via `close-run.ts`), never by `enrich` — that command reads run platforms
  and must never write one. A single-member `catalog ∩ config.platforms`
  resolves with no prompt and reports `platform_source: "intersection"`, which
  is an inference from ownership and is therefore always stated in prose.
  Anything more ambiguous leaves `null` and still closes: exit 3 here would be
  refusing to close a session over a metadata field.
- **Only a platform the user *typed*** (`--platform`, or "Other" at a prompt)
  joins `config.platforms`. A pick from the catalog group is frequently
  someone else's console.
- `gamereg platform add <name> [synonyms...]` is also the rename: a name that
  already means an existing entry takes over, old name kept as a synonym.

`example-vault/` declares `platforms` and carries one game (`Tunic`) whose run
never got a platform — that fixture is what freezes "unknown renders as
absence" and the retroactive canonicalization (`SNES` → `Super Nintendo`,
`Switch` → `Nintendo Switch` in every rendered artifact, with the log
untouched).

Not in scope for phase 1, decided in `06-roadmap.md`: franchise/series grouping
(deferred past phase 1) and a backlog view for unplayed games (rejected — the
register holds what you played, not what you own).

### Things phase 1 already touched, worth knowing before going further

- **`build.obsidian.{run_notes,bases}`** still appears in the `07-targets.md`
  config example but `core/config.ts` does not parse it — unresolved from
  phase 0, not addressed this round. Either implement the keys or drop them
  from the spec; do not leave the example lying.
- **`images.*` config** (`max_edge`, `quality`, `keep_original`, `publish`) is
  implemented in `core/config.ts` and used by `src/images/ingest.ts` — the gap
  is only the CLI surface (item 1 above), not the config plumbing.
- **`gamereg.secrets.json`** is seeded by `init` (idempotent), gitignored, and
  read by `core/secrets.ts` — env var wins over the file per field. Never
  touched by `build` or any target.
- `csv`, `json` and `sqlite` do not disagree about a column — verified by the
  golden fixtures in `example-vault/` (all three targets are declared in its
  `gamereg.config.json` and built from the same fixture log).
- **Provider ambiguity is a return value, never a guess.** `findDetail` in
  `src/cli/commands/enrich.ts` returns `match`/`none`/`ambiguous`; a single
  target surfaces `ambiguous` as a menu (interactive) or exit 3 with
  `candidates[]` (non-interactive), `--all` always collapses it to `skipped`
  (never prompts, safe for cron). Edition-suffix stripping is deliberately
  off for provider matching (`normalize(title, { editions: false })`) —
  a catalog often lists an edition as its own entry with its own id, and
  stripping the suffix would falsely collide it with the base game. Platform
  narrowing reads `game.runs[].platform` (what the user actually typed),
  never `game.platforms` (which a prior `enrich` may have already overwritten
  with a different provider's data), and compares through the platform
  vocabulary — a run recorded as `SNES` narrows IGDB's "Super Nintendo
  Entertainment System", which the substring rule alone never managed; there
  is a live test for exactly that. Read the doc comment on `findDetail`
  before changing any of this, it explains the reasoning inline.

## Non-negotiables

These come from `00-architecture.md` and are not style preferences:

1. `data/events.jsonl` is append-only. No code path rewrites or deletes a line.
2. `gamereg build` is idempotent — byte-identical output on a second run,
   including binary targets.
3. Nothing outside `<!-- gamereg:... -->` markers is modified in a note. Test it.
4. No write command performs network I/O. `enrich` is a separate command, and it
   is the only one that reaches the network.
5. Every state mutation appends at least one event.
6. Durations, ratings and session state are computed in code. Never inferred.
7. Output format and interactivity are two independent axes, both defaulted from
   the environment. The interactive menu is a presenter over the same candidate
   array a JSON caller gets — never a second resolution code path.
8. A target reads the folded state and the config. Nothing else — not the
   filesystem, not the network, not its own previous output, not another
   target's.
9. The build removes only what the manifest says it owns. Never by pattern,
   never a seeded `.base`, and never at all when the manifest is missing.
10. SQLite is a cache, never a source of truth. Deleting `data/log.db` costs
    nothing, `query` only reads it, and nothing but the build writes it.
11. A user cover (`source: user`) is never replaced by enrichment, not even under
    `--covers --force`. Only `cover --reset` gives provider art back.
12. GPS and the rest of EXIF are stripped on ingest. Not configurable off.

If a task seems to require breaking one of these, stop and raise it rather than
working around it.

## Layout

What exists today, with the phase 1 additions marked:

```
src/
  cli/            commander wiring, one file per command under commands/
  core/           events, fold, duration, time, vocab, config, vault, errors
  resolve/        normalization, matching, candidate ranking
  render/         remark pipeline, marker splicing, note/run/table emitters
  targets/        registry, manifest, writer, audit; one file per target
  db/             + phase 1: SQLite schema, build, query guard
  providers/      + phase 1: igdb.ts behind a common interface
  images/         + phase 1: ingest pipeline, hashing, EXIF
  i18n/
templates/        Game Database.base and anything else seeded into a vault
example-vault/    fixtures: fictional events + expected output
test/             live/ holds opt-in network smoke tests — see Testing strategy
```

`render/` emits Markdown; `targets/` decides what files exist and applies them to
disk. A target plans, the writer writes — that split is what makes the write
policies (`replace` / `splice` / `seed`) a property of the artifact rather than
of the emitter.

## Testing strategy

Everything phase 0 established still holds, and phase 1 adds to it:

- **Golden files** are the primary tool. `example-vault/` holds a fixture event
  log and the exact expected output. Every target ships its fixture; a target
  with no golden file is not done. That now includes `sqlite`, `json` and `html`.
- **Idempotency test:** build, snapshot, build again, assert byte equality,
  across every enabled target, binary ones included. For SQLite this means a
  fixed page size and no timestamps in the file.
- **Ownership test:** build with a target enabled, disable it, build again,
  assert its files are gone and nothing else moved. Then delete the manifest and
  assert the build still succeeds and deletes nothing.
- **Seed test:** build, edit `Game Database.base`, build again, assert the edit
  survives; then `--force` and assert it does not.
- **Preservation test:** a note with hand-written prose in every position —
  before, between and after blocks — survives a build unchanged.
- **Fold properties:** replaying a log twice yields identical state; an `amend`
  applied to any event produces the same state as if the original had been
  written that way.
- **No network in unit tests, ever.** Providers are mocked at the interface, and
  a test that would open a socket is a bug in the test.
- **Live smoke test, opt-in only — run it when you touch provider matching.**
  `npm run test:live` (`test/live/*.live.ts`, deliberately outside the
  `npm test` glob) hits the real IGDB API. It exists because a mocked
  test can only be wrong about a real catalog's shape in the way the person
  writing it happened to guess — that's exactly how a real bug shipped:
  IGDB carries "Final Fantasy VII Remake: Deluxe Edition" as its own entry,
  not looser phrasing of the base game, and no hand-written mock reproduced
  that. **Run `npm run test:live` whenever you change `normalize()`
  (`src/resolve/normalize.ts`), `findDetail`/`enrichGame`
  (`src/cli/commands/enrich.ts`), or the provider's `search`/`fetch`
  (`src/providers/igdb.ts`).** A green `npm test`
  does not mean matching still works against a real catalog — only this
  does. It needs real credentials (env vars, or
  `example-vault/gamereg.secrets.json`, gitignored); every test in the file
  skips itself cleanly when the credential it needs is absent, so it is
  always safe to run and safe to skip. It never writes to the committed
  `example-vault` — everything runs against a throwaway copy. If a test that
  used to pass starts failing, read the failure before assuming the fix
  broke something: a provider's catalog can change too.
- **Ingest determinism:** the same photo ingested twice yields the same hash, the
  same file, and no second write. Assert the stripped EXIF is actually gone.
- **Query guard:** the SQL allowlist is a security boundary — test what it
  refuses (multiple statements, `PRAGMA`, `ATTACH`, comments hiding a second
  statement, `WITH ... DELETE`), not only what it accepts.
- Use `node:test`. No test framework dependency.

## Conventions

- TypeScript, ESM, Node 22+. `strict: true`, no `any` in `core/`.
- Errors carry the exit code from `02-cli.md`. One error class, a `code` field.
  Phase 1 makes code 6 (`provider_unavailable`) real — it means the local work
  was still committed.
- All user-facing strings come from `i18n/`. No hardcoded English in `src/`,
  including error messages.
- The persona (see `05-agent.md`) belongs to prose output only. JSON output and
  event payloads stay neutral.
- Commit messages: conventional commits, English.

## Versioning

SemVer, tied to the roadmap phases in `06-roadmap.md`, not to conventional
feature-by-feature bumps:

- `0.0.0` — phase 0. `0.1.0` — phase 1. `0.2.0` — phase 2, and so on.
- `1.0.0` lands only when every phase in `06-roadmap.md` is done, not before.
- A patch version (`0.x.1`) is a bug fix within an already-tagged phase, not a
  new phase.

Tagging a finished phase (or patch — same steps, `v0.X.Y`):

1. Commit the phase's work as normal.
2. Tag the commit that completes the phase: `git tag -a v0.X.0 -m "..."`, with
   the message summarizing what shipped (see `v0.0.0` for the shape). This
   message is also the release notes in step 4 — write it accordingly, not
   as a terse label.
3. Bump `version` in `package.json` **and** `package-lock.json` to the next
   phase's version (`npm version minor --no-git-tag-version` for a phase bump),
   as a separate commit — `chore(release): bump version to 0.X.0 for phase N`.
   This commit is untagged; it marks the start of the next phase's work, not
   its completion.
4. `git push && git push --tags`, then publish the tag as a GitHub Release —
   `gh release create v0.X.Y --title "v0.X.Y — <short summary>" --notes-from-tag`.
   `--notes-from-tag` reuses the annotated tag message from step 2 verbatim, so
   there is exactly one place the release description is written, not two that
   can drift apart. The most-recently-created release is what GitHub marks
   "Latest", so create any out-of-order backfill tags oldest first.

Only tag a phase once it is actually done — don't pre-bump speculatively. Never
tag or push without being asked; versioning is a deliberate, user-triggered
action in this repo, not something to do alongside an unrelated commit.

## Language

Repository language is English: code, comments, docs, commit messages, issues.
Portuguese is a shipped locale (`i18n/pt-BR.json`), not the language of the
project.

## What to ask about rather than assume

- Anything requiring a schema change to `01-model.md`
- A new build target, or a target that needs to read anything but folded state
- Adding a runtime dependency beyond the stack table in `00-architecture.md`
- Anything that writes outside the vault root

All open questions in `06-roadmap.md` are resolved as of this phase; the
remaining two items there (retroactive session start, timezone changes while
travelling) are deferred by design, not blocking anything now.
