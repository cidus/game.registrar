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
`obsidian` (game notes, run notes, `Games.md`, seeded `Games.base`) and `csv`.
`example-vault/` is the golden fixture for both.

**Phase 1 is nearly done.** `CURRENT_PHASE` in `core/vocab.ts` is `1`.
Implemented and tested: provider credentials, `providers/igdb.ts` +
`providers/rawg.ts` behind a common interface, `enrich` (including provider
ambiguity handling — a menu or exit 3 + `candidates[]`, `--match <ref>` to
re-invoke, and platform-aware narrowing/auto-resolution from the game's
recorded runs), resolution step 6 in `gamereg search` (never in a write
command — see non-negotiable 4), the `sqlite`/`json`/`html` targets, `query`,
`import`, and the image ingestion *pipeline* (`src/images/ingest.ts` +
`exif.ts` — EXIF read then stripped, normalize, hash, write to
`assets/<sha[0:2]>/<sha>.webp`). `npm test` runs 264 tests (`node --test`, no
framework, no network). `npm run test:live` (opt-in, real IGDB/RAWG calls,
skips cleanly with no credentials — see Testing strategy below) adds 6 more;
run it whenever you touch provider matching.

**Two things remain before phase 1 is actually done:**

1. **Image ingestion's CLI surface.** The pipeline above works and is
   tested in isolation, but nothing calls it yet: no `--photo` /
   `--caption` / `--kind` / `--as-cover` on any recording command, no
   `attach`, no `cover`, no `gallery` block in the game note. `fold.ts`
   already handles `attachment.add`, `game.cover` and inline
   `attachments[]` on any event — has since phase 0 — so this is CLI and
   render work, not model work.
2. **Platform vocabulary** — requested by the user, **specified but not
   implemented**. Full spec is in `docs/spec/02-cli.md`'s "Platform
   vocabulary" section (and a short note under `start`'s section, above
   it): `gamereg.config.json` gains `platforms: string[]` — a suggestion
   list, never a validator (`platform` stays free text everywhere it
   already is; `01-model.md` and `03-resolution.md` are unchanged). New
   subcommands `gamereg platform add <name>` / `gamereg platform remove
   <name>`, an interactive multi-select-with-"Other" loop in `gamereg init`,
   and a single-select-with-"Other" fallback in `gamereg start` when no
   platform resolves any other way — whatever gets typed via "Other" is
   appended to `config.platforms` so the list grows from actual use. Read
   the spec section before starting; it names exact flags, exact command
   shapes, and the existing `init.ts` prompt patterns (`askTargets()`) to
   reuse rather than inventing new UI. **This is the next thing to build.**

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
  with a different provider's data) — read the doc comment on `findDetail`
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
  providers/      + phase 1: igdb.ts, rawg.ts behind a common interface
  images/         + phase 1: ingest pipeline, hashing, EXIF
  i18n/
templates/        Games.base and anything else seeded into a vault
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
- **Seed test:** build, edit `Games.base`, build again, assert the edit survives;
  then `--force` and assert it does not.
- **Preservation test:** a note with hand-written prose in every position —
  before, between and after blocks — survives a build unchanged.
- **Fold properties:** replaying a log twice yields identical state; an `amend`
  applied to any event produces the same state as if the original had been
  written that way.
- **No network in unit tests, ever.** Providers are mocked at the interface, and
  a test that would open a socket is a bug in the test.
- **Live smoke test, opt-in only — run it when you touch provider matching.**
  `npm run test:live` (`test/live/*.live.ts`, deliberately outside the
  `npm test` glob) hits the real IGDB/RAWG APIs. It exists because a mocked
  test can only be wrong about a real catalog's shape in the way the person
  writing it happened to guess — that's exactly how a real bug shipped:
  IGDB carries "Final Fantasy VII Remake: Deluxe Edition" as its own entry,
  not looser phrasing of the base game, and no hand-written mock reproduced
  that. **Run `npm run test:live` whenever you change `normalize()`
  (`src/resolve/normalize.ts`), `findDetail`/`enrichGame`
  (`src/cli/commands/enrich.ts`), or a provider's `search`/`fetch`
  (`src/providers/igdb.ts`, `src/providers/rawg.ts`).** A green `npm test`
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

Tagging a finished phase:

1. Commit the phase's work as normal.
2. Tag the commit that completes the phase: `git tag -a v0.X.0 -m "..."`, with
   the message summarizing what shipped (see `v0.0.0` for the shape).
3. Bump `version` in `package.json` **and** `package-lock.json` to the next
   phase's version (`npm version minor --no-git-tag-version` for a phase bump),
   as a separate commit — `chore(release): bump version to 0.X.0 for phase N`.
   This commit is untagged; it marks the start of the next phase's work, not
   its completion.

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
