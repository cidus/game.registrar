# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the versioning scheme described in `CLAUDE.md`
(SemVer tied to roadmap phases, not to feature-by-feature bumps).

The full reasoning behind a change — not just what changed — lives in the
annotated git tag (`git tag -n99 vX.Y.Z`) and, for standing decisions, in
`CLAUDE.md`. This file is the short version.

## [Unreleased]

### Added

- `Dockerfile` and `compose.yml`: the CLI and the OpenClaw gateway in one image,
  at versions pinned to work together. Three core services — the gateway, the
  maintenance loop, and a one-shot `provision` that registers the check-in cron
  job against the running gateway.
- `docker/entrypoint.sh`, which seeds an empty vault and commits it, configures
  git, installs the model credential into the per-agent auth store, deploys the
  skill and persona, and patches the gateway configuration from the environment
  on every boot. `--dry-run` performs nothing.
- `docker/loop.sh` and `scripts/autobuild.sh` as a container service: enrich,
  build, commit and push whenever the vault's tree is dirty.
- Optional compose profiles, all off by default: `site` (a Quartz build loop
  plus Caddy), `comments` (Remark42) and `tunnel` (cloudflared). `site` can
  serve the comments on its own origin under `/remark42`.
- `docs/deploy-container.md` and `.env.example`.
- `scripts/gamereg-autobuild.service` / `.timer` for a host install, and a
  systemd unit for the container stack.
- `test/entrypoint-wrapper.test.ts`, `test/loop-wrapper.test.ts` and
  `test/phase-citations.test.ts`.
- `run_open_event_id` and `session_open_event_id` on `gamereg open`'s rows, and
  `run_open_event_id` on each run of `gamereg status <game>`. These are the ids
  `amend` and `revoke` take; before them the only route to one was raw SQL over
  the `events` table.
- `agent/workspace/AGENTS.md` is now the operating card: boundary, JSON
  contract, call budget, the common path, buttons and safety, in the context of
  every turn.
- `agent/skills/gamereg/reference/media.md`, `corrections.md` and `checkins.md`
  — one file per rare flow, read only when that flow happens.
- `tools.allow` in `agent/openclaw.example.json5`, restricting the gateway's
  tool surface to `exec`, `message` and `read`.
- `gamereg due` — which open sessions are due a check-in now, with all three
  triggers (`duration`, `clock`, `day_cutoff`), the delivery windows, quiet
  hours, the escalating backoff ladder and the per-session ceiling. Reads and
  never writes; `--at` evaluates as if it were another time.
- `gamereg checkin <session_id> --trigger <t>` files a `session.checkin`, and
  `gamereg checkin --expire` amends every check-in still `snoozed` past
  `checkin.reply_window` to `no_reply`.
- The `checkin` config block (`after`, `clock`, `chase_at`, `backoff`,
  `max_per_session`, `reply_window`, `quiet_hours`, `persona_prompt`), with
  every value parsed and refused by its own path when malformed. The block
  documented in `05-agent.md` now loads instead of exiting 2 as an unknown key.
- pt-BR names for both commands (`pendencias`, `conferir`) and their flags.
- `agent/checkin.sh` — the hourly check-in poll for the gateway host. Sweeps
  unanswered check-ins, asks `gamereg due`, exits silently when nothing is due,
  and otherwise wakes the agent with every row in one message before filing a
  `snoozed` check-in for each. `--dry-run` performs none of it. A poll-started
  turn inherits no conversation, so the wake also carries the delivery routing
  (`GAMEREG_CHECKIN_CHANNEL`/`GAMEREG_CHECKIN_TO`, without which the question
  arrives without buttons) and the register's configured locale. `--at`
  evaluates as if it were another time, and `--dry-run` performs none of it.
- A *Check-ins* section in `agent/skills/gamereg/SKILL.md`: the register per
  trigger, the three exits (`break start`, `end --note`, nothing) and the amend
  that settles the record.
- Reaction tokens: a closed list of five identifiers (`filed`, `approved`,
  `archived`, `pending`, `puzzled`), a *Reactions* section in
  `agent/skills/gamereg/SKILL.md`, and `agent/workspace/REACTIONS.md` as the
  per-installation mapping table. Its emoji column ships filled, one per token,
  because an emoji is the same character everywhere and there is nothing to
  obtain; the sticker column ships empty and no artwork ships at all, because a
  `file_id` names a file in the user's own set. Nothing in the CLI, the config
  or the log touches this.
- `agent/openclaw.example.json5` carries `channels.telegram.actions.sticker`,
  `actions.reactions` and `reactionLevel`, commented out and off, with what each
  one gates. `agent/README.md`'s step 11 covers how a Telegram `file_id` is
  obtained and why a sticker is a second tool call rather than a presentation
  block.
- The `stats` build target: `obsidian/Stats.md` (totals, a row per year, a row
  per genre, every year's calendar), one `obsidian/reviews/<year>.md` per year
  played, and `obsidian/reviews/heatmap-<year>.svg`. Both notes are spliced, so
  prose written around the generated tables survives every later build.
- A calendar heatmap and a year in review as shared renderers
  (`src/render/heatmap.ts`, `src/render/review.ts`): pure functions from folded
  state to strings, with the heatmap as inline SVG carrying its own palette and
  no runtime dependency. `Games.html` embeds the most recent year's heatmap from
  the same renderer.
- A *Heatmap and year in review* section in `docs/spec/04-derived.md` — what
  every figure is counted from — and a `stats` section in `07-targets.md`.
- A *year in review* flow in `docs/spec/05-agent.md` and in
  `agent/skills/gamereg/SKILL.md`: the agent reads the figures with `query` and
  may offer a drafted opening paragraph, which the user pastes outside the
  markers. The build never generates prose, and no command files it.
- The `quartz` build target: `quartz/content/games/*.md`,
  `quartz/content/runs/*.md` and `quartz/content/index.md` — the register again
  in the flavour Quartz reads, with the consolidated table as the front page —
  plus a seeded `quartz/quartz.config.yaml`. An ordinary target: it plans from
  folded state, reads no other target's output, spawns no subprocess and never
  runs Quartz. Emitting Quartz's input is where gamereg stops.
- Two rendering flavours in `src/render/flavour.ts`. The Obsidian one is
  unchanged byte for byte; the Quartz one adds `description` and `draft` to
  frontmatter, names the folder in a wikilink, drops the empty *Notes* heading,
  and renders a placeholder wherever `images.publish` keeps an asset off the
  site.
- Assets are mirrored into `quartz/content/assets` when `images.publish` is on,
  by the same add-only hardlink pass that serves `obsidian/assets` (moved to
  `src/targets/mirror.ts`).
- `gamereg import` completes the phase-1 deliverable it shipped only half of:
  `verdict` is now a mapping field, filing a `run.verdict` alongside a row's
  `run.import` when mapped; the field table, mapping-file shape, exit codes and
  per-row failure contract are documented in `docs/spec/02-cli.md`; and
  `docs/getting-started.md` gets a worked *Coming from a spreadsheet* section
  — a small CSV, its mapping, `--dry-run`, the result — including the two
  non-obvious warnings (permanent residue from an unmatched title, and empty
  heatmap/year-in-review years for imported history). No behavior beyond the
  new field changed; the engine already worked.
- `gamereg enrich --missing`, a bulk selector alongside `--all`: every game
  never actually enriched for `--provider` (default `igdb`), reading folded
  state, mutually exclusive with `--all`, `--match` and `<query>`. Inherits
  `--all`'s bulk mode, so an ambiguous provider match collapses to `skipped`
  rather than exit 3 — what actually makes an incremental cron `enrich` safe:
  without it, `--all` re-fetches the whole catalog on every run. Tracked by a
  new derived `enrichedProviders` field on folded game state (`core/fold.ts`),
  set only when a real `game.enrich` event has landed — not by the presence of
  a provider id alone, since `start --id <provider ref>` with no local match
  creates a game carrying just that bare reference (no metadata, no network
  call, by design) for a later enrich to fill in. With `--covers`, `--missing`
  also selects a game that already has metadata but no cover on record,
  backfilling art for anything enriched before `--covers` existed. pt-BR
  names for the command (`enriquecer`) and its flags (`--faltando`,
  `--correspondencia`, `--provedor`, `--capas`), filling in a gap left when
  `enrich` shipped with no localization at all.
- `scripts/autobuild.sh` — periodic vault maintenance: when `git status` shows
  the vault is not clean, runs `gamereg enrich --missing --covers`, then
  `gamereg build`, then commits and pushes (only once a remote is configured).
  Carries no state of its own; a lock conflict (exit 5) or a provider failure
  (exit 6) is non-fatal and the next tick just finds more to do.
  `gamereg-autobuild.service`/`.timer` (systemd --user units) register it.
  `--dry-run` performs none of it.
- `scripts/vendor-quartz.sh` — scripts the manual procedure for getting an
  actual Quartz site: copies a real Quartz checkout's framework files into
  `<vault>/quartz/`, from an explicit allowlist that excludes the checkout's
  own `content/`, `quartz.config.yaml`, `.github/` workflows and other
  upstream-project files that are not the framework. Never touches the
  vault's own seeded `content/`/`quartz.config.yaml`. The checkout comes from
  either `--source <path>` (reuse one already on disk) or `--clone`
  (fetches `jackyzha0/quartz` fresh into a throwaway temp dir, shallow;
  `--tag <ref>` pins it to a release instead of the default branch) —
  mutually exclusive, and `--tag` only makes sense with `--clone`.
  `package.json` is merged rather than overwritten (a destination-only
  dependency — a theme installed by hand after a missing-module build error
  — survives a rerun) and `package-lock.json` is never copied, only
  regenerated by `npm install` (not `npm ci`, which a merged package.json
  would no longer match) against the merged file. `npx quartz build` runs as
  a verification step and surfaces the Quartz error as-is on failure — no
  attempt to detect or install a missing theme package on its own. Seeds a
  minimal `wrangler.jsonc` for Cloudflare Workers static-asset deploy if one
  doesn't exist yet, never overwriting a later hand edit. Rerunnable: a
  second run replaces the framework subdirectory wholesale (so a file
  upstream removed doesn't linger) while every other allowlisted file is
  just overwritten in place — the same command doubles as the upgrade path.
  `agent/README.md`'s step 10 documents it as one verified path to a working
  site, not the
  phase-5 answer for how deployment works.

### Changed

- `agent/skills/gamereg/SKILL.md` is 865 bytes and unread in the common case:
  the routing table moved to `AGENTS.md`, which costs nothing to consult, and
  *A year in review* moved to `reference/query.md`, where a year question
  already routes. What remains is the frontmatter and a pointer.
- The deployed prompt no longer cites repository paths (`docs/spec/*`,
  `test/*`). The agent's workspace holds copies, not a checkout, so those were
  unreachable; the claim each one carried is restated without the path.
- Incident narrative was moved out of the prompt files and into
  `agent/README.md`. The prompt states the rule; the deployment log keeps the
  story of how it was found.
- `test/agent-skill.test.ts` asserts a size budget for `agent/workspace/*.md`,
  the files compiled into the system prompt on every turn.
- `agent/skills/gamereg/SKILL.md` was a routing table (4KB, from 56KB). The
  standing orders moved to `AGENTS.md`, which the gateway keeps in context, and
  the rare flows to `reference/`. A session that opens, pauses, resumes,
  finishes and files a verdict now reads no file at all.
- `agent/workspace/SOUL.md` roughly halved, and its allowance for an aside
  rewritten as three positive triggers rather than a list of moments to avoid.
  Non-operative canon moved to `agent/PERSONAS.md`.
- `--dry-run` is advised for `past` and `import` only; everything else is one
  `revoke` from undone.
- `test/agent-skill.test.ts` discovers every prompt file instead of naming
  three, so a new `reference/*.md` inherits the ASCII, `--sql` and
  command/flag checks; a new test asserts every routed reference file exists
  and every existing one is routed to.
- The phase-3 site target is named `quartz`, not `site`, and writes `quartz/`
  rather than `site/`. It names the consumer, the way `obsidian` does, and
  leaves the generic name free for a second generator later. Renamed before the
  target was implemented, so nothing on disk migrates — but a vault that named
  `site` in `build.targets` to see the phase-3 message now gets an unknown-value
  error instead.
- `CURRENT_PHASE` is `3`, which is what makes `stats` and `quartz` reachable.
  `UNBUILT_TARGETS` (in `core/vocab.ts`, guarded by a test against the registry)
  named `quartz` between the two steps and is empty again now that it is built:
  every target the vocabulary declares, this version builds.
- `day_cutoff` is validated when the config is read rather than when a fold
  first uses it.
- `agent/skills/gamereg/reference/cli.md` documents `break start`/`break end`
  with the target they have always taken (`[query]`, `--id game:<game_id>`). It
  described them as taking no arguments, which left the agent unable to say
  which session it meant.
- `gamereg open` and `gamereg due` rows carry `last_checkin_id`. It is the
  agent's only route to the check-in it has to amend: the wake is enqueued
  before the record is filed, so the id cannot travel with the question.
- `agent/skills/gamereg/SKILL.md` no longer has the agent run `enrich`/`build`
  as backgrounded, unreported calls after every new game or closed session —
  `scripts/autobuild.sh` (above) does that now, on its own schedule, with
  nothing spent deciding it and no lost build when two ticks land close
  together. The agent may still run `gamereg build --json` when the user asks
  for it explicitly.

### Fixed

- The query guard refused `pragma` but not `pragma_table_info(...)`: `_` is a
  word character, so the word-boundary scan read straight past the
  table-valued-function form. The reserved `pragma_` and `sqlite_` namespaces
  are now refused outright.
- The Remark42 service no longer receives the whole `.env`. Compose loads an
  `env_file` wholesale, so the one container reachable from the internet held
  the model credential, the Telegram bot token, the tunnel token and the IGDB
  keys, none of which it reads. Every variable it needs is named explicitly.
- The Cloudflare tunnel token moved from argv, where it was visible in
  `/proc/<pid>/cmdline`, to the environment.
- The Quartz site is built in a scratch directory rather than in the vault, so
  the vault can be mounted read-only for a service that executes third-party
  plugin code.
- Values interpolated into the gateway's JSON5 configuration patches are
  escaped, so a quote in one cannot add configuration keys.
- `provision --dry-run` no longer contacts the gateway.
- `reference/query.md` lists the columns of the four views, not only of the
  tables, and warns that three of them are already aggregated: they carry
  `hours` and never `minutes`, and `COUNT(*)` over them counts groups. The
  agent had written `SUM(minutes)` against `v_sessions_by_day` and got an exit
  2. `test/agent-skill.test.ts` now applies `SCHEMA_SQL` to an in-memory
  database and compares against `pragma_table_info` rather than parsing SQL.
- The call that strips an answered button, in `agent/workspace/AGENTS.md`, is
  the verified one: `edit` requires `target`, `messageId`, `message` (the
  original text again, since it re-sends rather than patches) and the empty
  buttons inside `presentation`. The documented shape named `to`, put `buttons`
  at the top level and omitted `message`, and had never worked.
- The common path in `AGENTS.md` shows real invocations with real values
  instead of a flag-name synopsis that would break if copied.
- The button example in `agent/workspace/AGENTS.md` is a whole `message` send
  with the question in its `message` field, not a bare `presentation` fragment.
  The fragment led the agent to build the wrapper itself and fill `message`
  with the literal string `"placeholder"`, delivering correct buttons under it
  and losing the question. `test/agent-skill.test.ts` holds the example whole.
- `reference/query.md` now lists every table and its columns, and warns that a
  question about hours recorded is not the same as hours finished. The agent
  had invented `FROM v_sessions` — adjacent to the real `v_sessions_by_day` —
  which exited 2 in front of the user. Two tests hold the list and every
  offered view name to `src/db/schema.ts`.

## [0.2.0] - Phase 2 — Chat and voice

### Added
- A chat agent for [OpenClaw](https://openclaw.ai) (`agent/`): message → CLI
  invocation, ambiguity (exit code 3) rendered as inline buttons resolved by
  a real tap, voice notes transcribed upstream of the CLI, and verdict
  drafting offered on `finish`. Confirmed live end to end, including a
  session opened and a session closed entirely by voice.
- A local game's candidate now carries `cover_url` (from its provider-sourced
  cover), matching what a provider candidate already returned — lets the
  agent render one photo+button per candidate. A user-photo cover has no URL
  yet, only a local asset hash, so it stays `null`.

### Changed
- `Steam Deck` is a synonym of `PC` in the built-in platform table, so a Deck
  run resolves against a catalog instead of matching nothing. Declaring
  `Steam Deck` in `config.platforms` keeps it a platform of its own.

### Fixed
- `search --platform` narrows the provider's own query instead of filtering the
  page it returned, so a match the catalog ranks far down (Super Mario World,
  Super Mario RPG on SNES) is found rather than truncated away.
- The platform table carries IGDB's spellings for the Sega consoles
  (`Sega Mega Drive/Genesis`, `Sega Master System/Mark III`); without them
  `search --platform genesis` returned nothing at all.

## [0.1.2] - phase 1 patch

### Added
- `hours_source: "mixed"` for a run with both a stated baseline and measured
  sessions.
- Obsidian game notes carry an `aliases: [title]` field, so the quick switcher
  finds a note by the title someone actually types.
- Run notes carry a denormalized `cover` property, used by the Shelf cards
  view and the Game List table.

### Changed
- `search` ranks provider results by how many platforms match
  `config.platforms`, and widens the raw IGDB fetch so a platform-tagged match
  is no longer lost below the old top-8 cutoff.
- `search --platform` and `amend --set platform=...` now canonicalize through
  the platform table (e.g. `PSX` matches a provider's "PlayStation").
- `start --past-hours` and `past` filed without `--ended` now open a run with
  a stated baseline and no session, instead of implying one starts now.
- Everything the `obsidian` target writes now lives under `obsidian/`, not the
  vault root — `assets/` stays at the vault root, `obsidian/assets` is a
  symlink to it.
- `Games.md` / `Games.base` renamed to `Game List.md` / `Game Database.base`
  (both used to display as a bare, indistinguishable "Games").
- Run notes are named `<started_on>-<slug>.md`, date first, so a plain
  filename sort is chronological.

### Fixed
- The non-interactive candidate listing no longer leaks a literal
  `"{platforms}"` placeholder into its own output.
- A real Obsidian Bases parse failure (`groupBy` needs both `property` and
  `direction`).

### Removed
- The RAWG provider (offline since before it was first noted). IGDB is the
  only provider now.

## [0.1.1] - phase 1 patch

### Changed
- `enrich --covers` now runs the provider's cover URL through the same
  normalize/hash/assets pipeline `--photo` uses, instead of only storing the
  URL. `game.enrich`'s `cover` field carries `{ url, sha256 }`.

### Fixed
- A `source: user` cover is never overwritten by enrichment, and is never
  even fetched over.

## [0.1.0] - Phase 1 — Metadata, images and query

### Added
- Provider credentials and enrichment (IGDB/RAWG behind a common interface),
  ambiguity resolved as candidates/menu, platform-aware narrowing from
  recorded runs.
- `sqlite`, `json`, and `html` build targets.
- `query` and `import` commands.
- Image ingestion: EXIF read then stripped, normalize, hash,
  content-addressed `assets/<sha[0:2]>/<sha>.webp`, and its CLI surface
  (`--photo`, `--caption`, `--kind`, `--as-cover`, `attach`, `cover`, the
  gallery block).
- Platform vocabulary: canonicalization, suggestion groups, late-fill on
  close.

328 tests, no network in the default test suite.

## [0.0.0] - Phase 0 — The register, no AI

### Added
- Event log: append, fold, amend/revoke.
- Duration arithmetic, local resolution.
- Recording and query commands, `verdict`.
- `build` as a target registry with manifest-based ownership.
- The `obsidian` and `csv` targets.
- `doctor`.

136 tests, no network in the test suite.

[Unreleased]: https://github.com/cidus/game.registrar/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/cidus/game.registrar/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/cidus/game.registrar/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/cidus/game.registrar/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cidus/game.registrar/compare/v0.0.0...v0.1.0
[0.0.0]: https://github.com/cidus/game.registrar/releases/tag/v0.0.0
