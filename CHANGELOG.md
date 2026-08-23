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
  per-installation mapping table. Nothing in the CLI, the config or the log
  touches this.
- `agent/openclaw.example.json5` carries `channels.telegram.actions.sticker`,
  `actions.reactions` and `reactionLevel`, commented out and off, with what each
  one gates. `agent/README.md`'s step 9 covers how a Telegram `file_id` is
  obtained and why a sticker is a second tool call rather than a presentation
  block.

### Changed
- `day_cutoff` is validated when the config is read rather than when a fold
  first uses it.
- `agent/skills/gamereg/reference/cli.md` documents `break start`/`break end`
  with the target they have always taken (`[query]`, `--id game:<game_id>`). It
  described them as taking no arguments, which left the agent unable to say
  which session it meant.
- `gamereg open` and `gamereg due` rows carry `last_checkin_id`. It is the
  agent's only route to the check-in it has to amend: the wake is enqueued
  before the record is filed, so the id cannot travel with the question.

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
