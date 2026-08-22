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

**Phases 0–2 are functionally done. Phases 0/1 are tagged (`v0.1.0`, patched
by `v0.1.1`/`v0.1.2`); phase 2 is not tagged yet — `package.json` still
reads `0.2.0` ahead of a tag, pending the maintainer's go-ahead (see
*Versioning* below).** Phase 2's exit criterion — an entire game logged
start to finish with no terminal — has now been demonstrated live end to
end, voice included: `start` through chat, a code-3 menu resolved by an
actual inline-button tap, a session closed by a voice note, `finish` with a
drafted verdict. `agent/README.md`'s *Voice* section and its smoke test
record the confirmation. `CURRENT_PHASE` in `core/vocab.ts` stays `1`
regardless; it only gates which build targets are available, and phase 2
adds none — bumping it is part of the tagging step, not a prerequisite for
it.

Phase 3 (`due`/`checkin`/cron, reaction tokens, the Quartz site) is
specified in full in `docs/spec/05-agent.md` and `06-roadmap.md`; none of it
is implemented — see `agent/README.md`'s *What is not here*.

`npm test` is 397 tests, all green (`node --test`, no framework, no network).
`npm run test:live` (opt-in, real IGDB calls, skips cleanly with no credentials)
adds 8.

## The agent layer

`agent/` at the repo root: `skills/gamereg/` (`SKILL.md` plus `reference/cli.md`
and `reference/query.md`), `workspace/` (persona files), `openclaw.example.json5`,
`approvals.example.json`, `README.md`, and `PERSONAS.md` (how the two clerks are
*drawn* — avatar prompts and visual canon, deployed nowhere and read by nobody
at runtime; `workspace/SOUL.md` wins any disagreement).

**`agent/README.md` is the deployment log — read it before touching the live
deployment, not this file.** It carries every operational trap found running
this for real: `npm link` serving stale `dist/`, a skill only reaching *new*
conversations, non-zero exit codes surfacing as errors in chat, the exact
button payload shape (the docs and the gateway's own injected prompt disagree —
docs won), state-database paths left behind by a user migration. Don't
duplicate that content here; this section is only what a *coding* session needs.

Six source changes landed because of the agent layer, each tested:
`GAMEREG_SOURCE` validation (`cli/context.ts`), `query --schema`
(`cli/commands/query.ts`), a build-write lockfile (`targets/lock.ts`),
`gamereg vocab` (`cli/commands/vocab.ts` — see *Language*), `start`'s
`also_open` field (reports sessions open on other games, so the agent can offer
to close them — see *Decisions* below), and `candidateOf` propagating
`cover_url` for a local game's provider-sourced cover, matching what a
provider candidate already returned (`resolve/resolve.ts` — the agent renders
one photo+button per candidate when every candidate has one).

**Live vault:** `/opt/gamereg-vault` (group `gamereg`). Gateway runs as
`alcides`, system-wide install (`/usr/bin/openclaw`, `/usr/bin/gamereg`). The
gateway's own log and session transcripts
(`~/.openclaw/agents/<agent>/sessions/*.jsonl`) settle questions no test can —
most of the fixes below came from reading one.

## Decisions worth not re-litigating

Each of these cost real time to find. The reasoning, not just the rule:

- **`amend`/`revoke` are not behind a platform approval gate.** Live testing
  found the approval UI unreliable (including the agent fabricating an approval
  id when the tool gave it none); confirmation moved into `SKILL.md` as a
  conversational protocol instead. A wrong `amend` costs one more `amend`,
  never data.
- **The agent never sees the CLI's localized prose.** JSON is neutral by
  contract, so `gamereg vocab` exists to hand it *words* (outcomes, statuses,
  the register's own acts, and the nouns for its entities — game/run/session/
  break/verdict) without ever handing it a sentence template it could fill in
  and fabricate. `i18n/` stays the one place a term is written down; no
  glossary in the agent layer, no per-language skill.
- **A title is completed only when the user's own words are unambiguous.**
  "Super Mario" names a family, not one game; the agent corrects *how* a title
  was written (spelling, casing), never *which game* was meant. It searches
  with the user's literal words, and several candidates — even at exit code
  0 — is the same question code 3 asks. Matters more than it looks: once a
  guessed title exists locally, `search` stops asking the provider at all.
- **Against a provider, the platform hint narrows the *query*, not the result
  page.** IGDB's relevance for a family name is dominated by near-duplicates —
  `search "Super Mario"` opens with fifteen e-Reader card levels and puts Super
  Mario World at rank 64, Super Mario RPG at 103 — so filtering the fetched
  window by platform afterwards returned two SNES entries out of a dozen.
  `provider.search` takes every spelling of the hint and filters server-side by
  platform *name* (`where platforms.name = (...)`), never by a table of provider
  platform ids: the table in `core/platforms.ts` already carries the catalogs'
  own spellings, which is the only reason that works. Do not "fix" this by
  raising `SEARCH_FETCH_LIMIT`; the games wanted are past any window worth
  fetching. A narrowed search that comes back empty retries unnarrowed, so a
  spelling IGDB does not use costs relevance and not every result — the same
  judgement as the bullet below. Two spellings were in fact missing
  (`Sega Mega Drive/Genesis`, `Sega Master System/Mark III`), and
  `--platform genesis` returned nothing at all until they were added.
- **`Steam Deck` is a synonym of `PC` in the built-in table, on purpose.** No
  catalog lists it as a platform, so its own entry would be a platform nothing
  could ever be resolved against. Canonicalization runs on read, so this reaches
  the register too: a Deck run displays as PC, retroactively. Raised before it
  was done and chosen anyway; declaring `Steam Deck` in `config.platforms` takes
  it back, since the user's entry always wins.
- **The platform hint may cost a filter, never a duplicate record.** An empty
  `game.platforms` is silence, not "exists nowhere," so it never filters
  (`matchesPlatform`); and when the hint alone empties the resolution pool,
  `resolveGame` retries without it. `start`/`past` resolve with `allowCreate`,
  so the old behavior didn't just miss — it filed a second record of a game
  already on record. Do not "fix" the first rule with `game.runs[].platform`
  as evidence; that reintroduces the bug for anyone replaying on a new console.
- **Undoing a mistake is `revoke`, last-written-first, checked with `doctor`.**
  A session opened on the wrong game (or the wrong game entirely) is undone by
  revoking every event the mistake produced, in reverse order — a `game.create`
  revoked before its `run.open` leaves an orphan reference. `doctor` names
  anything still dangling. Picking wrong at a code-3 menu is worse than it
  looks: resolving by `--id` files an alias, so the wrong pick answers silently
  from then on until that `game.alias` event is revoked too.
- **`core/platforms.ts` holds English names as *data*, not interface text** —
  the one deliberate exception to "no hardcoded English in `src/`." Carries
  providers' own spellings too, which is what makes catalog intersection work
  without provider platform ids.
- **Platform canonicalization runs on input *and* on read**
  (`canonicalizeState()` in `planBuild`) — the read pass retroactively fixes
  history with no `event.amend`. `fold` stays pure and never sees the table.
- **The late platform fill belongs to `end`/`finish`/`drop`, never `enrich`** —
  `enrich` reads run platforms and must never write one. Ambiguity leaves
  `null` and still closes.
- **Edition-suffix stripping is off for provider matching** — a catalog lists
  an edition as its own entry with its own id; stripping would falsely collide
  it with the base game.
- **Provider ambiguity is a return value, never a guess** — menu when
  interactive, exit 3 + `candidates[]` otherwise, `--all` always collapses to
  `skipped` so cron never prompts.
- **A `source: user` cover is never fetched, and never replaced by
  enrichment.** `game.enrich`'s `cover` reads as both a bare URL and
  `{ url, sha256? }` forever — the log is append-only.
- **`obsidian/assets` is hardlinks, not a symlink** — Obsidian on Linux does
  not traverse one. `mirrorAssets` only ever adds (nothing in gamereg deletes
  an ingested asset), which is what keeps it clear of non-negotiable 9.
- **The committed `data/log.db` is compared logically, not byte for byte** —
  SQLite's on-disk layout isn't stable across library versions. Determinism is
  still asserted on the bytes of a *second* build on one machine.
- **Config keys are strict: an unknown one exits 2**, valid names derived from
  `DEFAULT_CONFIG` so no second list can drift. Cost accepted: a newer
  gamereg's config can break an older binary — fine for one user, one machine.
- **Timezone needs no detection, and no per-invocation override.**
  `logical_day` is derived on every fold; `config.timezone` unset groups by the
  local day recorded (offset already in the log), a zone projects everything
  into it. Both stable under travel; only *editing* `config.timezone`
  re-groups history. See `01-model.md`'s *Logical day*.
- **A photo's `--kind` decides both the cover offer and the physical-media
  inference** — advisory in the model, load-bearing in the agent. `box`/`media`
  promotes to cover when none exists (nothing replaced, so no need to ask) and
  offers when one does; the same photo with `start` infers `--form physical`
  and says so, the way an inferred platform is always mentioned.
- **`example-vault/` carries two real, never-regenerated WebP assets** — a
  golden test for rendering never touches the encoder, only the event log and
  string arithmetic, so `sharp` version drift can't move the hash.

## Open items

- **Gaby has no `SOUL.md`.** She is drafted only inside Veronika's
  (`agent/workspace/SOUL.md`) — a name, a closed tabletop counter, and a
  relationship — so that phase 4's second agent inherits a settled character
  instead of inventing one late. Her own persona files land with phase 4, and
  the two personas have to agree: she is Veronika's inverse, warm and
  physically clumsy but *immaculate in the register*, and she calls Veronika
  "V". Until then her counter stays closed, which is deliberate — the fiction
  and the roadmap say the same thing, so the agent cannot offer a board-game
  capability that does not exist. `agent/PERSONAS.md` holds the visual canon
  her text will have to agree with, and which details are canon rather than
  set dressing.

- **Packaging and first-run setup are phase 5, deliberately last.** The shape
  was settled early so the phases before it do not paint it into a corner: a
  generator collects secrets and connectivity and emits declarative
  configuration, the image pins CLI, gateway, skill and persona together, and
  everything that is merely preference — timezone, platforms, which targets —
  is asked in chat by a *second* skill with its own binary, gated by
  `requires.bins` and gone from the PATH and the exec allowlist once setup
  finishes. That last detail is what keeps `agent/workspace/AGENTS.md`'s
  boundary intact: the agent still executes one allowlisted binary and still
  writes no file itself. Two things must stay true or the idea rots — the
  system has to work with no conversation at all (defaults apply; the wizard is
  refinement, never a gate), and no secret may be collected in chat, because
  the transcript lands in `~/.openclaw/agents/<agent>/sessions/*.jsonl` in
  plaintext. Nothing here is built. What already landed from the design is D9
  and invariants 14-15 in `00-architecture.md`, which hold whether or not any
  of this is ever built.

Add the next one here rather than in a commit message nobody will search for.

## Non-negotiables

The same list as `00-architecture.md`'s *Invariants*, same numbering — cite
either name and the number means one rule. Not style preferences:

1. `data/events.jsonl` is append-only. No code path rewrites or deletes a line.
2. `gamereg build` is idempotent — byte-identical output on a second run,
   including binary targets.
3. Nothing outside `<!-- gamereg:... -->` markers is modified in a note. Test it.
4. Delete every derived artifact, rebuild, lose nothing. A build argument
   narrows a build; it never defines what the vault contains.
5. No write command performs network I/O. `enrich` is a separate command, and it
   is the only one that reaches the network.
6. Every state mutation appends at least one event.
7. Durations, ratings and session state are computed in code. Never inferred.
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
13. Output format and interactivity are two independent axes, both defaulted from
    the environment. The interactive menu is a presenter over the same candidate
    array a JSON caller gets — never a second resolution code path.
14. Every configurable value can be set without a TTY. A setting reachable only
    through an interactive prompt is a bug — the agent has no terminal, and
    neither does an unattended install.
15. Nothing is coupled to an install path. The vault is wherever `--vault` or
    `GAMEREG_VAULT` says, and `i18n/`/`templates/` are found relative to the
    code, never to a home directory or a fixed prefix.

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
folder actually opened as a vault; `assets/` stays at the vault root, hardlinked
into `obsidian/assets`.

## Testing strategy

- **Golden files are the primary tool.** `example-vault/` holds a fixture log and
  the exact expected output for every enabled target. A target with no golden
  file is not done. Text is compared as bytes; `data/log.db` through
  `dumpDatabase` (`test/helpers.ts` — see *Decisions* above).
- **Idempotency:** build, snapshot, build again, assert byte equality across
  every target, binary ones included.
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
  refuses, not only what it accepts.
- **No network in unit tests, ever.**
- **`npm run test:live`** — run whenever you touch `normalize()`,
  `findDetail`/`enrichGame`, or `providers/igdb.ts`'s `search`/`fetch`. A green
  `npm test` does not mean matching still works against a real catalog.
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
4. Move `[Unreleased]` in `CHANGELOG.md` to a new `[0.X.Y]` section
   (Keep a Changelog format — `Added`/`Changed`/`Fixed`/`Removed`, one line per
   item, no narrative). This is the terse index; the tag message from step 2
   stays the detailed version, and `CHANGELOG.md`'s own header explains that
   split so a reader lands on the right one.
5. `git push && git push --tags`, then
   `gh release create v0.X.Y --title "v0.X.Y — <summary>" --notes-from-tag`.
   `--notes-from-tag` keeps the description in exactly one place. GitHub marks
   the most recently *created* release "Latest", so backfill oldest first.

Only tag once the phase is actually done. **Never tag or push without being
asked** — versioning is user-triggered here, never done alongside unrelated work.

`package.json` reads `0.2.0` ahead of the tag this time, at explicit request,
while phase 2 got more live testing before it's called finished. That
testing is now done — text and voice both confirmed live (see *Current
state*) — so `v0.2.0` is ready to tag whenever asked; no further version
bump needed first.

## Language

**Everything this repository writes is in English: code, comments, docs, commit
messages, issues, and the agent's prompt in `agent/`.** Example utterances in
`05-agent.md` and `SKILL.md` illustrate a mapping (message → invocation), not a
claim about which language anyone speaks.

The only non-English text in the repository is data: `i18n/*.json`; `02-cli.md`'s
*Command name mapping (pt-BR)* table (shipped interface, not prose);
`example-vault/` (fictional user content); and `Pokémon` in `03-resolution.md`/
`test/normalize.test.ts` (a Unicode-normalization fixture). Anything else in
another language is drift.

**The agent keeps no glossary of its own — it asks the CLI**, via
`gamereg vocab --locale <tag> --json`. `i18n/` stays the one place a term is
written down; a per-locale reference file or a per-language skill would be a
copy that can silently disagree with it. `test/vocab.test.ts` holds the line:
no placeholders in the block (the whole safety argument — a sentence template
can be filled in and fabricate; a word cannot), every locale covering the same
terms, every enum token having one.

`test/agent-skill.test.ts`'s "the skill and its references are written in
English, with no phrasebook" enforces the English-only rule by refusing
non-ASCII letters in `SKILL.md` and `reference/`.

## Protected regions

Text between `<!-- human-owned -->` and `<!-- /human-owned -->`, in any file
in this repository, is never edited, rewritten, reworded, or deleted by an AI
session — not even as a side effect of a broader edit to the same file, and
not even if the surrounding request seems to call for it. If a change appears
to require touching a protected region, stop and ask instead of editing
around it or through it. The marker pair is the author's own, added by hand;
nothing in tooling enforces it — this rule is what enforces it.

## What to ask about rather than assume

- Anything requiring a schema change to `01-model.md`
- A new build target, or a target that needs to read anything but folded state
- Adding a runtime dependency beyond the stack table in `00-architecture.md`
- Anything that writes outside the vault root
