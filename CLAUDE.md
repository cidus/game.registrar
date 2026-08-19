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
the build is a registry of targets, not a single emitter. The specs are the
description of the system; this file is only what a session needs on top of
them: current state, decisions that would otherwise be re-litigated, and open
items.

## Current state

**Phase 0 and phase 1 are done and tagged** (`v0.1.0`, patched by `v0.1.1` and
`v0.1.2`; `package.json` reads `0.1.3`). Everything in `06-roadmap.md`'s phase 0
and phase 1 lists is built, tested and covered by golden fixtures in
`example-vault/`: the event log and fold, the recording and query commands,
`build` as a target registry with a manifest and ownership-based cleanup, the
`obsidian` / `csv` / `sqlite` / `json` / `html` targets, IGDB behind a `Provider`
interface, `enrich`, image ingestion with its full CLI surface (`--photo`,
`attach`, `cover`), the platform vocabulary, `query` and `import`.

**Phase 2 (chat and voice) is in progress and not tagged.** `CURRENT_PHASE` in
`core/vocab.ts` is still `1` — deliberately, because the roadmap's exit
criterion ("an entire game logged start to finish without opening a terminal
once") has not been demonstrated in one unbroken pass. See *The agent layer*
below.

`npm test` is 388 tests, all green (`node --test`, no framework, no network).
`npm run test:live` (opt-in, real IGDB calls, skips cleanly with no credentials)
adds 8.

## The agent layer

`agent/` at the repo root: `skills/gamereg/` (`SKILL.md` plus `reference/cli.md`
and `reference/query.md`), `workspace/` (`IDENTITY.md`, `SOUL.md`, `AGENTS.md`,
`TOOLS.md` — the Registrar's persona as versioned files, not improvised live),
`openclaw.example.json5`, `approvals.example.json`, and `README.md`.

**`agent/README.md` is the deployment log, and it is required reading before
touching a live deployment.** Every config key in the examples was found wrong by
the upstream docs at least once and corrected against a real install; the README
says which. This section does not replace it.

Four source changes landed because of the agent layer, each with tests:
`GAMEREG_SOURCE` validated rather than cast (`cli/context.ts`), `query --schema`
(`cli/commands/query.ts`, so an agent can write SQL with no source tree), a
lockfile around `build`'s write phase (`targets/lock.ts` — `data/log.db` has no
rename-into-place, so racing builds could tear it; verified with 8 concurrent
processes), and `gamereg vocab` (`cli/commands/vocab.ts`, the register's words
in one locale — see *Language*, which is where the reasoning lives).

**Proven live, each independently:** `start` opening a session through chat and
`finish` with a drafted verdict; recording via `past`; photos arriving with a
`start` and landing on `session.open`; the platform question for a run with no
session (`amend` on `run.open`); `amend` on a `run.import` event; ad hoc `query`,
including the cache building itself on demand; a real native exec approval
(`exec.approval.waitDecision`, resolved by an actual tap, once
`channels.telegram.execApprovals.approvers` was set explicitly — `enabled: true`
alone is insufficient).

**Not yet proven:** inline buttons. The capability is on
(`capabilities.inlineButtons: "allowlist"`), the interface is documented from the
installed gateway, and the agent has now composed a correct-looking call —
which arrived with no buttons because it passed `buttons` as a JSON *string*
instead of an array. The gateway answered `ok` with a `messageId` and dropped
them silently, so the failure looks like a plain-text reply. `SKILL.md` now
forbids the string form explicitly; still unrendered as of that change.
Voice input is implemented CLI-side but untested through the deployment. Sticker
sends are wired (`channels.telegram.actions.sticker`) but unused — blocked on
sourcing real `fileId`s, not a code gap.

**The live vault is at `/opt/gamereg-vault`** (group `gamereg`), and the gateway
runs as `alcides` — same user as the checkout, installed system-wide
(`/usr/bin/openclaw`, `/usr/bin/gamereg`). Its log is the only record of how the
agent actually behaves, and reading it settles questions no test can: the
photo-classification fix below came from finding `kind: screenshot` on a
photograph of a boxed Master System game.

**A skill change reaches new conversations only** — the prompt is read into a
session once, at its start, and a gateway restart does not re-read it for a chat
in progress (`/reset` does). Testing a deployed fix in the conversation you were
already having measures the old text and looks exactly like the fix failing.
Grep the session transcript for a phrase unique to the new version first.

**`gamereg` on `PATH` runs `dist/`, not `src/`.** Nothing changed under `src/`
reaches the agent, or the terminal, until `npm run build`. Worth checking first
whenever live behaviour disagrees with the code you are reading.

## Decisions worth not re-litigating

Each of these cost real time to find. The reasoning, not just the rule:

- **`amend`/`revoke` are not behind a platform approval gate.** They were, off
  the exec allowlist; live testing found the approval UI unreliable enough
  (including the agent fabricating an approval id when the tool gave it none)
  that the confirmation moved into `SKILL.md` as a conversational protocol —
  state the change, wait for an unambiguous yes, then run. A wrong `amend` costs
  one more `amend`, never data. `agent/README.md` documents the revert path.
- **`core/platforms.ts` holds English names as *data*, not interface text** —
  the one deliberate exception to "no hardcoded English in `src/`". It carries
  the providers' own spellings too, which is what makes the catalog intersection
  work without provider platform ids. Do not move it to `i18n/`.
- **Platform canonicalization runs on input *and* on read** (`canonicalizeState()`
  at the top of `planBuild`). The read pass is what retroactively fixes history:
  a synonym added today re-renders decade-old runs with no `event.amend`. `fold`
  stays pure and never sees the table.
- **The late platform fill (`cli/platform.ts`) belongs to `end`/`finish`/`drop`,
  never to `enrich`** — `enrich` reads run platforms and must never write one.
  Ambiguity leaves `null` and still closes; exit 3 there would be refusing to
  close a session over a metadata field. Only a platform the user *typed* joins
  `config.platforms`.
- **Edition-suffix stripping is off for provider matching**
  (`normalize(title, { editions: false })`) — a catalog lists an edition as its
  own entry with its own id, and stripping would falsely collide it with the base
  game. Platform narrowing reads `game.runs[].platform`, never `game.platforms`
  (a prior `enrich` may have overwritten that). Read the doc comment on
  `findDetail` before changing any of it.
- **Provider ambiguity is a return value, never a guess** — menu when
  interactive, exit 3 + `candidates[]` otherwise, and `--all` always collapses to
  `skipped` so cron never prompts.
- **A `source: user` cover is never fetched at all**, not merely discarded after.
- **`game.enrich`'s `cover` reads as both a bare URL string and `{ url, sha256? }`**,
  forever. The log is append-only; old lines are never rewritten.
- **Obsidian's Bases:** `groupBy` needs both `property` *and* `direction` —
  omitting `direction` fails to parse the whole file, not just that view. The
  cards view always titles a card by filename, with no YAML override; `image:`
  is a real view-level key. All confirmed against the official help source and
  kepano's vault, not inferred.
- **Run notes are `<started_on>-<slug>.md`, date first** — a plain filename sort
  is then chronological (`render/run.ts`'s `runNoteNames()`).
- **RAWG was removed entirely** — offline as of 2026-08, both `api.rawg.io` and
  `rawg.io` timing out. `PROVIDER_CREDENTIAL_FIELDS` (`core/secrets.ts`) and
  `KNOWN_PROVIDERS` (`providers/registry.ts`) list only `igdb`; those two places
  are where a second provider joins, in the shape RAWG used.
- **Run notes and the Bases seed are structural, not configurable.**
  `07-targets.md` advertised `build.obsidian.{run_notes,bases}` for four phases;
  nothing parsed it, and the keys were dropped rather than built. `run_notes:
  false` breaks a cascade — the seeded `Game Database.base` queries
  `file.inFolder("runs")` and would come back empty, and `render/note.ts`'s
  wikilinks would point at notes that do not exist — and `bases: false` cannot
  mean anything coherent, since a seed is written once and never removed
  (non-negotiable 9), so flipping it later would do nothing at all.
- **Config keys are strict: an unknown one exits 2** (`rejectUnknownKeys` in
  `core/config.ts`), with the valid names derived from `DEFAULT_CONFIG` so no
  second list can drift from the type. This is what let the phantom keys above
  survive four phases. The cost, accepted: a config written by a newer gamereg
  now breaks an older binary instead of being ignored — fine for one user, one
  machine, git as sync.
- **A photo's `--kind` is the hinge, and the agent kept getting it wrong.** The
  model calls `kind` advisory — presentation, never logic — but in the agent
  layer both the cover decision and the physical-media one hang off it, so a
  photograph of a box filed as a `screenshot` silently costs both. Live evidence
  in `/opt/gamereg-vault`. The rules now: `box`/`media` with no cover on the
  game promotes (`--as-cover`) and says so, since nothing is replaced; with a
  cover already there it offers; and the same photo arriving with a `start`
  passes `--form physical` and mentions it, the way an inferred platform is
  always mentioned. `--form` exists only on `start`/`past`, so the same
  conclusion later is an `amend`, which is offered, never inferred.
- **Timezone needs no detection, and a per-invocation override was rejected.**
  `logical_day` is derived on every fold; `config.timezone` unset groups a
  session by the local day where it was recorded (the offset is already in the
  log), and a zone projects everything into that zone. Both are stable when the
  machine's clock moves, so travelling asks nothing of the user — editing
  `config.timezone` is the only thing that re-groups history. Detecting a
  phone's zone through the gateway cannot help: the CLI runs on the always-on
  host that stayed home, so the register would end up grouping by which device
  filed an event. `01-model.md`'s *Logical day* has the table.
- **`obsidian/assets` is hardlinks, not a symlink.** Obsidian on Linux does not
  traverse a symlink, so the original bridge left every embed in the vault
  showing nothing while working fine on macOS. `mirrorAssets`
  (`targets/obsidian.ts`) hardlinks each file instead — one inode, two names,
  no disk cost — falling back to a copy only where a link cannot be made. It
  only ever adds, which is what keeps it clear of non-negotiable 9: these are
  not planned files, nothing in gamereg deletes an ingested asset, and a name
  that exists is already the right bytes because the path *is* the hash.
- **`example-vault/` carries two real WebP assets, and they are never
  regenerated.** They were produced once by the ingestion pipeline and committed;
  no test re-encodes them, so `sharp`'s version cannot move the hash the way it
  moves `data/log.db`'s bytes. The earlier judgement that a photo fixture was not
  worth it rested on needing a deterministic *encoder*, which a golden test for
  rendering never touches: the note is written from the event log, and
  `assetPath()` is string arithmetic. The fixture earned itself immediately — a
  game-level attachment was being dated with the empty string, which rendered a
  bare `**` into the note and sorted it before everything else.
- **The platform hint may cost a filter, never a duplicate record.** Two rules,
  both in `03-resolution.md`: an empty `game.platforms` is silence rather than
  "exists nowhere", so it never filters (`matchesPlatform`); and when the hint
  alone empties the pool, `resolveGame` resolves again without it. The second
  matters because `start`/`past` resolve with `allowCreate` — the old behaviour
  did not just return `not_found`, it filed a *second* record of a game already
  on record and split the history between two ids. Do not "improve" the first
  rule by counting `game.runs[].platform` as evidence: it reads as better data
  and reintroduces the same bug for anyone replaying a Switch game on a console
  they bought later.
- **The committed `data/log.db` is compared logically, not byte for byte.**
  SQLite's on-disk layout is not stable across library versions and Node bundles
  its own (v26.0.0 → 3.53.1, v26.7.0 → 3.53.4), so a fixture committed from one
  Node version failed on another with identical content. `test/helpers.ts`'s
  `dumpDatabase` renders schema, tables and views as text and that is what the
  golden test compares; determinism is still asserted on the bytes themselves,
  where both files come from one machine. Non-negotiable 2 is unchanged — it is
  about a second build, which is where bytes are meaningful.

## Open items

None. Every question in `06-roadmap.md` is decided, and the items this file
used to carry — the phantom `build.obsidian` config keys, `matchesPlatform` on
an empty `game.platforms`, the missing photo fixture, the timezone question —
are resolved above or in the specs. Add the next one here rather than in a
commit message nobody will search for.

## Non-negotiables

From `00-architecture.md`. Not style preferences:

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

```
src/
  cli/            commander wiring, one file per command under commands/
  core/           events, fold, duration, time, vocab, config, platforms, secrets
  resolve/        normalization, matching, candidate ranking
  render/         remark pipeline, marker splicing, note/run/table emitters
  targets/        registry, manifest, writer, audit, lock; one file per target
  db/             SQLite schema, build, query guard
  providers/      igdb.ts behind a common interface
  images/         ingest pipeline, hashing, EXIF
  i18n/
templates/        Game Database.base and anything else seeded into a vault
example-vault/    fixtures: fictional events + expected output
test/             live/ holds opt-in network smoke tests
agent/            OpenClaw skill, workspace persona, deployment examples + log
docs/spec/        the specification; docs/getting-started.md is the user guide
```

`render/` emits Markdown; `targets/` decides what files exist and applies them to
disk. A target plans, the writer writes — that split is what makes the write
policies (`replace` / `splice` / `seed`) a property of the artifact rather than
of the emitter. The `obsidian` target writes under `obsidian/`, which is the
folder actually opened as a vault; `assets/` stays at the vault root with
each asset hardlinked into `obsidian/assets` (a symlink was the first
implementation; Obsidian on Linux will not follow one).

## Testing strategy

- **Golden files are the primary tool.** `example-vault/` holds a fixture log and
  the exact expected output for every enabled target. A target with no golden
  file is not done. Text is compared as bytes; `data/log.db` is compared through
  `dumpDatabase` (`test/helpers.ts`) — see *Decisions* above for why, and
  `test/sqlite.test.ts`'s "the logical dump distinguishes databases a byte
  comparison would", which is what keeps that comparison honest.
- **Idempotency:** build, snapshot, build again, assert byte equality across
  every target, binary ones included. This one stays on the bytes: both files
  come from the same machine, so nothing excuses a difference.
- **Ownership:** enable a target, disable it, assert its files are gone and
  nothing else moved; then delete the manifest and assert the build deletes
  nothing.
- **Seed:** edit `Game Database.base`, rebuild, assert the edit survives; then
  `--force` and assert it does not.
- **Preservation:** hand-written prose in every position around the blocks
  survives a build unchanged.
- **Fold properties:** replaying twice yields identical state; an `amend` yields
  the same state as if the original had been written that way.
- **Ingest determinism:** same photo twice, same hash, same file, no second
  write, and the stripped EXIF is actually gone.
- **Query guard:** the SQL allowlist is a security boundary — test what it
  refuses (multiple statements, `PRAGMA`, `ATTACH`, comments hiding a second
  statement, `WITH ... DELETE`), not only what it accepts.
- **No network in unit tests, ever.** A test that opens a socket is a bug in the
  test.
- **`npm run test:live` — run it whenever you touch `normalize()`
  (`resolve/normalize.ts`), `findDetail`/`enrichGame` (`cli/commands/enrich.ts`),
  or `providers/igdb.ts`'s `search`/`fetch`.** A green `npm test` does not mean
  matching still works against a real catalog; only this does. It exists because
  a mock can only be wrong in the way its author guessed — which is exactly how a
  real bug shipped (IGDB carries "Final Fantasy VII Remake: Deluxe Edition" as
  its own entry). It needs credentials (env, or the gitignored
  `example-vault/gamereg.secrets.json`), skips cleanly without them, and never
  writes to the committed fixture. If it starts failing, read the failure first:
  a catalog can change too.
- Use `node:test`. No test framework dependency.

## Conventions

- TypeScript, ESM, Node 22+. `strict: true`, no `any` in `core/`.
- Errors carry the exit code from `02-cli.md`. One error class, a `code` field.
  Code 6 (`provider_unavailable`) means the local work was still committed.
- All user-facing strings come from `i18n/`. No hardcoded English in `src/`,
  including error messages — `core/platforms.ts` is the one exception, above.
- The persona (`05-agent.md`) belongs to prose output only. JSON output and event
  payloads stay neutral.
- Commit messages: conventional commits, English.

## Versioning

SemVer tied to the roadmap phases, not to feature-by-feature bumps: `0.0.0` was
phase 0, `0.1.0` phase 1, `0.2.0` phase 2. `1.0.0` lands only when every phase in
`06-roadmap.md` is done. A patch (`0.x.1`) is a bug fix within an already-tagged
phase.

To tag a finished phase or patch:

1. Commit the work as normal.
2. `git tag -a v0.X.Y -m "..."` on the commit that completes it. **The message is
   also the release notes** (step 4) — write it as such, not as a label. See
   `v0.0.0` for the shape.
3. Bump `version` in `package.json` **and** `package-lock.json` as a separate,
   untagged commit (`npm version minor --no-git-tag-version` for a phase).
4. `git push && git push --tags`, then
   `gh release create v0.X.Y --title "v0.X.Y — <summary>" --notes-from-tag`.
   `--notes-from-tag` keeps the description in exactly one place. GitHub marks
   the most recently *created* release "Latest", so backfill oldest first.

Only tag once the phase is actually done. **Never tag or push without being
asked** — versioning is user-triggered here, never done alongside unrelated work.

## Language

**Everything this repository writes is in English: code, comments, docs, commit
messages, issues, and the agent's prompt in `agent/`.** That includes the
example utterances in `05-agent.md` and `SKILL.md` — a user saying "starting
hollow knight" is an illustration of a mapping (message → invocation), not a
claim about which language anyone speaks.

The only non-English text in the repository is data, and there are exactly four
kinds of it: `i18n/*.json`; `02-cli.md`'s *Command name mapping (pt-BR)* table,
which documents shipped interface (`iniciar`, `--nota`) and is not prose;
`example-vault/`, which is fictional user content and may be whatever a user
would write; and `Pokémon` in `03-resolution.md` and `test/normalize.test.ts`,
a Unicode-normalization fixture. Anything else in another language is drift.

**The agent keeps no glossary of its own, but it is not left without one
either — it asks the CLI.** `gamereg vocab --locale <tag> --json`
(`cli/commands/vocab.ts`) reports the `vocab` block of `i18n/<locale>.json`:
the words for outcomes, statuses, criteria, difficulties, forms and modes, plus
the register's own acts (`vocab.register` — *filed*, *approved*, *archived*,
*pending clarification*, *certified copy*). `i18n/` stays the one place a term
is written down; a `reference/locale/pt-BR.md` would be a copy that can disagree
with it silently, and per-language *skills* are worse still — N copies of every
behaviour rule, drifting, with one anti-drift test able to check only one.

**Do not "simplify" this by handing the agent a bundle.** It reports `vocab` and
nothing else, on purpose: `prose` carries `{title}` and `{time}`, and a model
given a sentence template can fill it in and emit something indistinguishable
from output the CLI actually produced — the exact fabrication the neutral-JSON
rule exists to prevent. A word cannot be filled in. `test/vocab.test.ts` holds
that line: no placeholders in the block, every locale covering the same terms,
every enum token in `core/vocab.ts` having a word, and no other block travelling
in the response.

The reason this exists at all corrects a claim this file used to make: **the
agent never sees the CLI's localized prose.** JSON is neutral by contract and a
gateway is never a TTY, so `"Protocolada: …"` is written for humans only. Every
word a chat user reads was chosen by the model, which is why English "filed"
turned up mid-sentence in Portuguese conversations, and why `"difficulty":
"hard"` was being translated freehand on every narration.

What replaces same-language examples is stating the **rule** rather than the
phrasing. "An approximation is still a time the user gave you; silence is not"
holds for "around 8" and "umas 20h" alike; an example in either language does
not. Where a Portuguese example used to carry a rule implicitly, the rule is
now written out — see `SKILL.md`'s *A session that was never recorded*.

`test/agent-skill.test.ts`'s "the skill and its references are written in
English, with no phrasebook" enforces the first half of this by refusing
non-ASCII letters in `SKILL.md` and `reference/`. The rest is convention.

## What to ask about rather than assume

- Anything requiring a schema change to `01-model.md`
- A new build target, or a target that needs to read anything but folded state
- Adding a runtime dependency beyond the stack table in `00-architecture.md`
- Anything that writes outside the vault root
