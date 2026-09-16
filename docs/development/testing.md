# Testing

This page covers how the test suite is organized, what each kind of test
protects, what the tests don't cover, and what CI runs. The checks to run before
a pull request are listed in
[CONTRIBUTING.md](../../CONTRIBUTING.md#development-setup).

## Running the tests

```bash
npm test
npm run typecheck
node --test test/golden.test.ts
node --test --test-name-pattern="seed" test/targets.test.ts
npm run test:live
```

| Command | What it runs |
|---|---|
| `npm test` | `node --test "test/**/*.test.ts"`: every unit and integration test. It needs no network and no credentials. |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/`. |
| `node --test <file>` | One file. Add `--test-name-pattern=<regex>` to filter by test name. |
| `npm run test:live` | `node --test "test/live/**/*.live.ts"`: real IGDB calls. Opt-in. |

The suite uses only `node:test` and `node:assert/strict`; don't add a test
framework. Tests import the TypeScript sources directly, which is why Node.js
22.18 or later is required. The shell script tests also need `sh` and `git` on
the `PATH`.

Two shared modules support the suite:

- [test/helpers.ts](../../test/helpers.ts) provides deterministic ULID-shaped
  ids, an event builder, and temporary directories that are removed on exit.
- [test/dump-db.ts](../../test/dump-db.ts) holds `dumpDatabase()`, which
  `helpers.ts` re-exports.

## What the suite covers

| Area | Files in `test/` |
|---|---|
| Golden files and build properties | `golden`, `targets`, `markers`, `build-lock`, `audit` |
| Targets and renderers | `csv`, `sqlite`, `json-target`, `html-target`, `stats-target`, `quartz-target`, `run-note` |
| Event log, fold and check-in triggers | `events`, `fold`, `duration`, `attachments`, `due` |
| CLI end to end, through the real binary | `cli`, `init`, `import`, `query`, `search`, `enrich`, `amend`, `verdict`, `checkin`, `platform-cli`, `photo-cli`, `provider-id-create`, `vocab` |
| Resolution and platforms | `resolve`, `normalize`, `platforms` |
| Providers and credentials | `providers`, `enrich-fallback`, `secrets` |
| Config and input parsing | `config`, `csv-parse` |
| Images | `ingest`, `exif` |
| Query guard | `guard` |
| Shell scripts | `checkin-wrapper`, `autobuild-wrapper`, `entrypoint-wrapper`, `loop-wrapper`, `vendor-quartz-wrapper` |
| Agent prompt | `agent-skill` |
| Documentation | `docs-links`, `docs-structure`, `phase-citations` |
| Live (opt-in) | `live/enrich.live.ts` |

Every file in the table except the last ends in `.test.ts`.

## Golden files

[example-vault/](../../example-vault/) is the primary test fixture. It holds a
fictional event log (`data/events.jsonl`), a config that enables every build
target, and the exact expected output of each target, including hand-written
prose around the generated blocks. A build target with no golden file is not
done.

[test/golden.test.ts](../../test/golden.test.ts) copies the vault to a
temporary directory and removes its `.gamereg/` bookkeeping. It then builds and
compares every file that the manifest says the build owns:

- **Text and SVG files** are compared as bytes, with a buffer comparison rather
  than decoded strings.
- **`data/log.db`** is compared logically. `dumpDatabase()` renders the schema
  and then every table and view row by row, and the two dumps must be equal.
  SQLite's on-disk layout is not stable across library versions, so the same
  data built with another Node.js version can differ in bytes. Byte-level
  determinism is still asserted by the idempotency test, which builds twice on
  one machine.
- **The fixture itself** is also checked: the log folds with no problems, and
  it exercises measured hours, stated hours and an open run.

`test/dump-db.ts` imports nothing but `node:sqlite`, so CI can run it on a
runner with no `node_modules`. Keep it a leaf module with a single
implementation, shared by the golden test and the image workflow.

### Update the golden files

When a change is meant to alter output, build a copy, review the difference,
and copy back only what you intended to change:

```bash
scratch="$(mktemp -d)"
cp -R example-vault/. "$scratch/"
rm -rf "$scratch/.gamereg"
node src/cli/main.ts build --vault "$scratch" --force
diff -r --exclude=.gamereg --exclude=log.db example-vault "$scratch"
node --no-warnings test/dump-db.ts example-vault/data/log.db > "$scratch/golden.sql"
node --no-warnings test/dump-db.ts "$scratch/data/log.db" > "$scratch/built.sql"
diff "$scratch/golden.sql" "$scratch/built.sql"
```

With no output change, both `diff` commands print nothing.

- `--force` matters when `templates/` changed. An ordinary build never
  rewrites a seeded file (`Game Database.base`, `quartz.config.yaml`), so
  without it the golden copy silently keeps the old seed.
- Copy `data/log.db` back only when its dump differs. It is the one `*.db`
  file the repository commits, and a rebuild can change its bytes without
  changing its content.
- Run `git diff --stat example-vault` and confirm that only the files you
  meant to change appear.

## Build properties

Each property is a test, and most of them are an invariant from
[00-architecture.md](../spec/00-architecture.md#invariants).

| Property | What is asserted | Where |
|---|---|---|
| Idempotency (invariant 2) | Build, snapshot, then build again. Every owned file is byte-identical, binary files included, and the second build writes and removes nothing. | `golden.test.ts` |
| Rebuild from nothing (invariant 4) | Delete every derived artifact and rebuild. The generated regions and the frontmatter come back exactly. | `golden.test.ts` |
| Ownership (invariant 9) | Disabling a target removes its files and moves nothing else. A file absent from the manifest is never removed. With the manifest missing or unreadable, the build writes everything and deletes nothing. | `targets.test.ts` |
| Seed | A seeded file is written once and then belongs to the user. An edit survives a rebuild, only `--force` overwrites it, and it is never removed, even when its target is disabled. | `targets.test.ts` |
| Preservation (invariant 3) | A block is replaced while everything around it stays byte-identical. Unpaired or nested markers are hard errors, and a marker inside a fenced code block is text. The prose half of a year in review survives a build. | `markers.test.ts`, `stats-target.test.ts` |
| Target contract (invariant 8) | Two targets planning the same path fail before any write, and no target can plan a path outside the vault. `quartz` plans from folded state and never reads another target's output, and the Obsidian output does not move. | `targets.test.ts`, `quartz-target.test.ts` |
| Concurrent builds | A second build on the same vault is refused while one runs, and a lock left by a dead process is recovered. | `build-lock.test.ts` |

## Fold properties

[test/fold.test.ts](../../test/fold.test.ts) asserts:

- Replaying the log twice yields identical state.
- An `amend` yields the same state as if the original event had been written
  that way, and revoking the amend restores the original payload.
- A revoked event is ignored by the fold and stays in the file.
- Orphan references are reported, not thrown.
- Durations and session state are computed, never estimated. For example, an
  open session contributes zero minutes (invariant 7).

[test/due.test.ts](../../test/due.test.ts) applies the same rule to check-ins.
The trigger evaluator is pure over folded state and an instant, so its table of
cases needs no clock.

## Ingest determinism

[test/ingest.test.ts](../../test/ingest.test.ts) asserts:

- The same photo ingested twice gives the same hash and the same file, with no
  second write.
- EXIF, GPS included, is absent from the output (invariant 12).
- A capture time read from EXIF is suggested, never applied silently.

The test images are generated with `sharp` inside the tests, so the suite
carries no binary photo fixture.

## Query guard

`gamereg query` runs SQL written by a user or an agent, which makes
[src/db/guard.ts](../../src/db/guard.ts) a security boundary. Test what it
refuses before testing what it accepts. When you change the guard, write the
refusal test first.

[test/guard.test.ts](../../test/guard.test.ts) refuses:

- more than one statement, including a second statement hidden behind a comment
- `PRAGMA`, and any name in the reserved `pragma_` and `sqlite_` namespaces
- `ATTACH`
- `WITH … DELETE`, plus every write, schema or transaction statement (`INSERT`,
  `UPDATE`, `DROP`, `ALTER`, `CREATE`, `VACUUM`, `REINDEX`, `BEGIN`/`COMMIT`)
- empty input, and an unterminated string literal, without crashing

It also checks that the guard does not refuse too much: a forbidden keyword
inside a string literal or a quoted identifier is allowed, and so is a name
that merely contains a reserved prefix mid-identifier.

## No network

Unit tests never open a socket:

- The IGDB provider takes an injected `fetchImpl`, which
  [test/providers.test.ts](../../test/providers.test.ts) replaces with a fake.
- CLI tests that reach provider code run without credentials, so they exercise
  the exit-6 path before any request is made.
- Shell script tests stub every command that would reach a network, a registry
  or a real gateway.

## Live tests

[test/live/enrich.live.ts](../../test/live/enrich.live.ts) calls the real IGDB
API. It catches what mocked providers cannot know, such as a catalog that lists
an edition as its own entry with its own id. Its name does not end in
`.test.ts`, so `npm test` never runs it.

- **When to run it.** With `npm run test:live`, whenever you touch
  `normalize()` in [src/resolve/normalize.ts](../../src/resolve/normalize.ts),
  `findDetail`/`enrichGame` in
  [src/cli/commands/enrich.ts](../../src/cli/commands/enrich.ts), or
  `search`/`fetch` in [src/providers/igdb.ts](../../src/providers/igdb.ts).
- **Credentials.** It reads `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` from the
  environment, or `example-vault/gamereg.secrets.json`, which is gitignored.
  Without credentials every test skips and says so.
- **Isolation.** It runs against a throwaway copy of `example-vault/` and never
  writes to the fixture.
- **Failures.** A failure is not necessarily a regression: a catalog entry can
  be renamed, re-released or delisted. Read the failure before changing code.
- **CI.** It runs weekly; see [CI](#ci).

## Shell script tests

The shell scripts run unattended on hosts nobody is watching. Each one has a
test that runs the real script end to end, with only the dangerous or external
parts replaced:

| Test | Script | Runs for real | Stubbed |
|---|---|---|---|
| `checkin-wrapper.test.ts` | [agent/checkin.sh](../../agent/checkin.sh) | `gamereg` against a real vault | `openclaw` |
| `autobuild-wrapper.test.ts` | [scripts/autobuild.sh](../../scripts/autobuild.sh) | `gamereg`, and `git` through a stub that logs each call and runs the real binary | `git` failures, injected on demand |
| `entrypoint-wrapper.test.ts` | [docker/entrypoint.sh](../../docker/entrypoint.sh) | `gamereg`, `git` | `openclaw` (every call logged; `cron list` and `config patch --stdin` controlled by the test) |
| `loop-wrapper.test.ts` | [docker/loop.sh](../../docker/loop.sh) | the loop | `autobuild.sh` |
| `vendor-quartz-wrapper.test.ts` | [scripts/vendor-quartz.sh](../../scripts/vendor-quartz.sh) | the script | `npm`, `npx` and `git`, as fakes that only log and exit |

Follow the same pattern in a new script test:

1. Put a stub executable where the script looks for the command: first on
   `PATH`, or in a variable such as `OPENCLAW_BIN`. The stub writes its argv to
   a log, one line per call, and exits with a code the test controls.
2. Run the script with `sh` against a real vault in a temporary directory,
   using the real `gamereg` from `src/cli/main.ts`.
3. When the script or `git` may write global configuration, set `HOME` to a
   temporary directory, so `git config --global` never touches the developer's
   own `~/.gitconfig`.
4. Pin time through the script's own flag (`checkin.sh --at`) instead of the
   wall clock.
5. Assert on the order and arguments of the stub calls, not only on the
   resulting vault.

`npm test` never builds the container image; the `image` workflow does.
`entrypoint-wrapper.test.ts` also reads the deployment files and asserts
properties that are invisible in a diff:

- a bare `docker compose up` starts only the core services
- `compose.yml` runs from a published image with no build context
- `image.yml` publishes only from `main` and never as `latest`
- the public-facing Remark42 service receives named variables rather than the
  whole `.env`
- no service declares a required variable
- the gateway health check is a bare TCP connect that starts no process
- the Dockerfile sets `HOME`

## Agent prompt tests

The files under `agent/workspace/` and `agent/skills/gamereg/` are read by a
model that cannot check them against the code.
[test/agent-skill.test.ts](../../test/agent-skill.test.ts) does that check
instead:

| Check | How |
|---|---|
| Commands and flags | Parses every `gamereg …` line in the prompt's fenced blocks and looks each command and flag up in the real commander program assembled from `src/cli/`. |
| SQL schema | Applies `SCHEMA_SQL` to an in-memory SQLite database, reads the columns back through `pragma_table_info`, and compares them with the tables and views listed in `reference/query.md`. Every view the prompt offers must be real. |
| English only | Refuses non-ASCII letters (typographic punctuation is allowed) in `workspace/AGENTS.md`, `workspace/SOUL.md`, `SKILL.md` and `reference/*.md`. |
| Size budget | The total size of `agent/workspace/*.md`, which the gateway puts into every turn, must stay under a fixed budget. |
| Routing | Every `reference/*.md` file the prompt routes to exists, and every existing one is routed to. |
| Examples | The button example is a whole `message` call with a real question in it. No `query` example invents a `--sql` flag. The skill declares the binary it needs. |
| Reactions | The skill names exactly the reaction tokens, and `REACTIONS.md` covers each one and ships no sticker id. |
| Workspace file policy | `docker/entrypoint.sh` classifies every shipped workspace file as replaced on every boot (code) or seeded (the user's), and `AGENTS.md` is replaced. |

When the size budget fails, work through these in order:

1. Take something out.
2. Move the procedure for a rare flow to a `reference/` file, which is read
   only when that flow happens.
3. Move the story of why a rule exists into a decision record, and keep only
   the rule.
4. Only then raise the number, on purpose, and say why in the commit.

[test/vocab.test.ts](../../test/vocab.test.ts) covers the words the agent is
given. `gamereg vocab` serves words and never sentence templates, so no
placeholders are allowed. It covers every token the CLI can put in a JSON
result, and it serves nothing else from the bundle.

The reasons behind these checks are in
[Agent design](../explanation/agent-design.md).

## Documentation tests

| Test | Fails when |
|---|---|
| [docs-links.test.ts](../../test/docs-links.test.ts) | A relative link in a hand-written Markdown file points at a missing file, or its `#anchor` matches no heading under GitHub's slug rules. Links inside code spans and fenced blocks are ignored, external URLs are not fetched, and `example-vault/`, `quartz/`, `dist/` and `node_modules/` are skipped. |
| [docs-structure.test.ts](../../test/docs-structure.test.ts) | Decision records are not numbered from `0001` without gaps, a record lacks its `# NNNN. Title` heading or its `Status` or `Date` line, a record is missing from `docs/decisions/README.md`, or a page under `docs/` is not linked from `docs/README.md`. |
| [phase-citations.test.ts](../../test/phase-citations.test.ts) | A roadmap phase is cited by number in `src/`, in a spec other than `06-roadmap.md`, or in a page describing the present: `docs/guides/`, `docs/reference/`, `docs/explanation/`, `docs/development/`, `docs/README.md` or `docs/getting-started.md`. |

The rules these tests enforce are in
[Writing documentation](documentation.md#style-rules).

## What the tests don't cover

Some behavior depends on software the suite never runs. When you change one of
these parts, check it by hand and say in the pull request what you ran.

| Change | Check by hand |
|---|---|
| Output of the `quartz` target, `templates/quartz.config.yaml`, or the `Game Database.base` seed as the site renders it | Build the generated `quartz/` tree with real Quartz, for example through `scripts/vendor-quartz.sh` or the `site` compose profile (see [Publish a site](../guides/publish-site.md)). Open the pages and confirm that wikilinks resolve, embeds load and the `.base` file renders as a table. gamereg never runs Quartz, so no test does. |
| `docker/entrypoint.sh`, `compose.yml` or the Dockerfile | Build and start the stack from your checkout (see [Build the container image from a checkout](../../CONTRIBUTING.md#build-the-container-image-from-a-checkout)) and follow the logs through a first boot. CI runs the entrypoint only with `--dry-run`, and the script tests stub `openclaw`. |
| The agent prompt, or a command's JSON output that the agent reads | Talk to the agent through a real gateway, then read the session transcripts: `~/.openclaw/agents/<agent>/sessions/*.jsonl` on a host, or the same path under the state directory `/config` in the container. The prompt tests check the files, not what a model does with them. |

## CI

| Workflow | Trigger | What it does |
|---|---|---|
| [test.yml](../../.github/workflows/test.yml) | Push to `main`; every pull request | On Node.js 22.18 (the `engines` floor) and 24: `npm ci`, `npm run typecheck`, `npm test`. |
| [image.yml](../../.github/workflows/image.yml) | Push to `main`; every pull request | The `verify` job builds the image and runs `gamereg --version` and `gamereg-entrypoint gateway --dry-run` in it. It then builds a copy of `example-vault/` inside the image as the runner's user, compares `data/log.db` through `test/dump-db.ts`, and compares every other file with `diff -rq`. On pushes to `main`, once `verify` passes, it also publishes the image; see [Container images](releasing.md#container-images). |
| [live.yml](../../.github/workflows/live.yml) | Weekly, Mondays at 06:00 UTC; manual dispatch | `npm ci` and `npm run test:live` on Node.js 22.18, with IGDB credentials from repository secrets. It fails if the secrets are missing, so it cannot pass after skipping everything. It never runs on pull requests. |

The clean-room build in `image.yml` runs on a different operating system, libc
and install path from any developer's machine. That makes it the strongest
check the project has for idempotent, byte-identical builds (invariant 2).
