# CLAUDE.md

Briefing for a coding session on this repository.

## What this is

`gamereg` — a CLI that records video game playthroughs into an append-only event
log, and regenerates Markdown notes, a consolidated table and a SQLite cache from
that log. An optional chat agent sits on top and does nothing but invoke the CLI.

**Read `docs/spec/` before writing code.** Start with `00-architecture.md`
(decisions and invariants), then `01-model.md` (the data model). Those two
constrain everything else. For anything touching `build`, add
`07-targets.md` — the build is a registry of targets, not a single emitter.

## Current state

Phase 0 is implemented: event log, fold with `amend`/`revoke`, duration
arithmetic, local resolution, the recording and query commands, `verdict`,
`build` and `doctor`. `npm test` runs the suite (`node --test`, no framework).

One deliberate gap: **image ingestion** (`--photo`, hashing, EXIF strip,
`cover`) was moved out of phase 0 by decision, so `sharp` is not a dependency
yet and there is no `gallery` block.

**The spec has moved ahead of the code.** `07-targets.md` is new and
`04-derived.md` was rewritten around it. Not yet implemented, and all of it is
phase 0:

- `build` as a target registry with a manifest (`.gamereg/manifest.json`) and
  ownership-based cleanup. This replaces the `previous_slugs` cleanup path in
  `render/build.ts` — delete it, do not keep both.
- Run notes: `runs/<slug>-<started_on>.md`, one per playthrough, fully generated
- Game notes carry `header`, `verdict` and `runs` blocks, with no session log and
  aggregate frontmatter; the session log lives in the run note
- `Games.base` seeded from `templates/`, written once and never regenerated
- The `csv` target

`example-vault/` still holds the fixtures the current code produces. Regenerating
them is part of the work, not a separate chore — the golden diff *is* the review.
Nothing outside this repo has ever been built with the old shape, so the fixtures
are the only thing that needs updating: write the new shape, do not write a
migration.

Also not built, as the roadmap intends: providers, SQLite, `query`, `due`,
`checkin`, `import`, the agent and the site.

## Non-negotiables

These come from `00-architecture.md` and are not style preferences:

1. `data/events.jsonl` is append-only. No code path rewrites or deletes a line.
2. `gamereg build` is idempotent — byte-identical output on a second run.
3. Nothing outside `<!-- gamereg:... -->` markers is modified in a note. Test it.
4. No write command performs network I/O.
5. Every state mutation appends at least one event.
6. Durations, ratings and session state are computed in code. Never inferred.
7. Output format and interactivity are two independent axes, both defaulted from
   the environment. The interactive menu is a presenter over the same candidate
   array a JSON caller gets — never a second resolution code path.
8. A target reads the folded state and the config. Nothing else — not the
   filesystem, not its own previous output, not another target's.
9. The build removes only what the manifest says it owns. Never by pattern,
   never a seeded `.base`, and never at all when the manifest is missing.

If a task seems to require breaking one of these, stop and raise it rather than
working around it.

## Layout to build toward

```
src/
  cli/            commander wiring, one file per command
  core/           events (append, fold, validate), duration, state
  resolve/        normalization, matching, candidate ranking
  render/         remark pipeline, marker splicing, note + table emitters
  targets/        registry, manifest, one file per target
  db/             SQLite schema, build, query guard
  providers/      igdb.ts, rawg.ts — phase 1, behind a common interface
  i18n/
templates/        Games.base and anything else seeded into a vault
example-vault/    fixtures: fictional events + expected output
test/
```

## Order of work for Phase 0

1. Event envelope + append + ULID + JSONL read/write
2. Fold to derived state, with `amend` / `revoke` applied
3. Duration arithmetic, including breaks and the logical-day rule
4. Enum validation with useful error messages listing valid tokens
5. `start` / `end` / `break` / `finish` / `drop` / `past` / `open` / `status`
6. Local resolution (steps 1–5 and 7 of `03-resolution.md`)
7. remark pipeline and marker splicing
8. Note and table emitters
9. Target registry, `build.targets` config, manifest and cleanup
10. Run notes, and the game note reshaped around them
11. `csv` target, `Games.base` seed
12. `doctor`

Ship each step with its tests. Do not build all commands then test.

## Testing strategy

- **Golden files** are the primary tool. `example-vault/` holds a fixture event
  log and the exact expected output. Any render change shows up as a diff. Every
  target ships its fixture; a target with no golden file is not done.
- **Idempotency test:** build, snapshot, build again, assert byte equality.
  Across every enabled target, binary ones included.
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
- **No network in unit tests.** Providers are mocked at the interface.
- Use `node:test`. No test framework dependency.

## Conventions

- TypeScript, ESM, Node 22+. `strict: true`, no `any` in `core/`.
- Errors carry the exit code from `02-cli.md`. One error class, a `code` field.
- All user-facing strings come from `i18n/`. No hardcoded English in `src/`,
  including error messages.
- The persona (see `05-agent.md`) belongs to prose output only. JSON output and
  event payloads stay neutral.
- Commit messages: conventional commits, English.

## Language

Repository language is English: code, comments, docs, commit messages, issues.
Portuguese is a shipped locale (`i18n/pt-BR.json`), not the language of the
project.

## What to ask about rather than assume

- Anything requiring a schema change to `01-model.md`
- A new build target, or a target that needs to read anything but folded state
- Adding a runtime dependency beyond the stack table in `00-architecture.md`
- Anything that writes outside the vault root
- The open questions listed at the end of `06-roadmap.md`
