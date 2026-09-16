# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to the versioning scheme described in `CLAUDE.md`
(SemVer tied to roadmap phases, not to feature-by-feature bumps).

The full reasoning behind a change — not just what changed — lives in the
annotated git tag (`git tag -n99 vX.Y.Z`) and, for standing decisions, in
`CLAUDE.md`. This file is the short version.

## [Unreleased]

### Removed

- `checkin.persona_prompt` from `gamereg.config.json`. It was parsed and
  validated but read by nothing in `src/`, `agent/`, `docker/` or `scripts/`,
  while `docs/spec/05-agent.md` described it as how the Registrar's voice is
  set — a setting that looked configured and did nothing. The register's
  persona lives on the gateway side, in `agent/workspace/SOUL.md`, and always
  did. A vault with `checkin.persona_prompt` set now exits 2 at load, naming
  it as an unknown key, the same as any other removed setting.

### Fixed

- `gamereg init --day-cutoff` with a malformed value exited 2 with the literal
  string `error.bad_cutoff` as its message — the i18n key existed in neither
  `i18n/en.json` nor `i18n/pt-BR.json`, so `t()` fell back to the raw key.
  Both locales now carry a real message naming the value.
- `i18n/pt-BR.json`'s `cli.commands` had no entries for `query`, `import`,
  `attach` or `cover`, so those four commands fell back to their English
  spelling under `--locale pt-BR` — while `docs/spec/02-cli.md`'s own mapping
  table claimed `query` → `consultar`. All four are mapped now
  (`consultar`/`importar`/`anexar`/`capa`), and the spec table is rewritten to
  match `i18n/pt-BR.json`'s `cli.commands` exactly, entry for entry — it had
  also been missing `status`, `doctor`, `alias`, `revoke`, `verdict`,
  `platform`, `add`, `remove` and `list`, which were shipped and translated
  but never documented.
- Config values of the wrong type were silently ignored, keeping the default,
  for `locale`, `timezone`, `defaults.platform`, `platforms` (non-array),
  `build.targets` (non-array), `build.csv.dir` and every `images.*` key —
  unlike every other setting, which has always exited 2 on a bad value. Now
  all of them do, at exit 2 with `error.bad_config_value` naming the key and
  the file, matching the strictness `checkin`'s block already had.
  `images.max_edge` and `images.quality` are also range-checked against what
  the image pipeline itself accepts: `{"images": {"quality": 0}}` used to load
  clean and only fail later, mid-ingest, with a message naming the photo file
  rather than the setting. `timezone` is checked against the IANA database, at
  both `loadConfig` and `gamereg init --timezone` — a well-typed but invalid
  zone used to write straight into `gamereg.config.json` unchecked and only
  fail the next time something tried to project an instant into it.
- `agent/checkin.sh --dry-run` no longer runs `gamereg checkin --expire` for
  real before checking `DRY_RUN`. The expiry sweep appends an `event.amend` for
  every stale `snoozed` check-in, so a dry run was writing to the append-only
  log despite being documented as filing nothing. The sweep now forwards
  `--dry-run` to `gamereg checkin --expire` itself.
- `docker/entrypoint.sh`'s `seed_vault()` only ran `git init` inside the branch
  guarded by "no `gamereg.config.json`". A vault mounted with a config already
  in place but no `.git` returned before ever becoming a repository, so
  `scripts/autobuild.sh` — which treats a dirty working tree as its entire
  state — could never run against it. The two checks are now independent; an
  existing vault's contents are still never touched.
- `docker/entrypoint.sh`'s `configure_model_auth()` returned immediately once
  `.gamereg-auth-seeded` existed, so replacing an expired
  `CLAUDE_CODE_OAUTH_TOKEN` in `.env` and restarting silently kept the old one
  in the auth store. The sentinel now holds a hash of the token last pasted
  (never the token itself) and the boot re-runs
  `openclaw models auth paste-token` when the hash changes.
- `images.keep_original` wrote the raw input bytes to disk, EXIF and GPS
  intact, breaking invariant 12 for every kept original — which then reached
  `obsidian/assets` and, with `images.publish`, `quartz/content/assets` through
  the ordinary hardlink mirror. It now goes through the same strip as the
  normalized copy: re-encoded with orientation baked in and no metadata
  carried through, same resolution and format as the source.
- The model fallback chain is actually reached when a rate limit hits. OpenClaw
  2026.9.4 retries the same model first and, on a 429, sleeps for the
  provider's `Retry-After` — 41 to 260 minutes from Anthropic across five
  logged incidents, against a turn abandoned after about six. The entrypoint
  writes `retry.provider.maxRetries: 0` into the agent's `settings.json`
  (`OPENCLAW_PROVIDER_MAX_RETRIES` to change it), so a refusal hands over
  instead of waiting.

### Added

- `OPENCLAW_MODEL_FALLBACK` takes a comma-separated chain, tried in order.
  With the same-model retry off, depth in the chain is what depth in retries
  used to be — and it costs no waiting on the model that just refused.

### Fixed

- The container replaces `AGENTS.md` and `TOOLS.md` on every boot instead of
  seeding them once. They are code — `test/agent-skill.test.ts` asserts their
  contents against the real binary and the real SQL schema — and seeding them
  meant an image upgrade shipped new behaviour with the old standing orders,
  silently. A card that had been edited is kept under `backups/` first.
- Workspace files that *are* the user's (`SOUL.md`, `IDENTITY.md`,
  `REACTIONS.md`, `USER.md`, `HEARTBEAT.md`) now carry the hash of what was
  seeded, so a boot can tell an edit from a shipped default that moved: an
  untouched file follows the image with no action from anyone, an edited one is
  kept and the boot logs a `NOTICE` naming the shipped copy and the way to take
  the new version. An install from before the tracking is left alone, loudly.

### Security

- `.dockerignore` now excludes `.env` and every `.env.*` variant except
  `.env.example`. The builder stage's `COPY . .` was pulling a filled `.env`
  into a local builder layer and the build cache for anyone building from a
  checkout (`compose.build.yml`) — the runtime stage never copies it in, so no
  secret reached a published image, but it did reach the machine's own Docker
  build cache.

### Removed

- `memory-core`'s nightly `dreaming` sweep, disabled in the boot config patch.
  It wrote a growing narrative diary into the workspace — and so into the
  system prompt of every turn — while `tools.allow` left the agent no tool that
  could query the memory it built. An existing `DREAMS.md` is moved out of the
  workspace and kept.

### Added

- `agent/workspace/USER.md` (house rules, never overriding *Safety*) and
  `agent/workspace/HEARTBEAT.md` (comments only). Both claim slots the gateway
  otherwise fills with its own defaults, which is what makes the deployed
  prompt equal to the shipped one — and the size budget, raised to 32,000,
  finally a measure of all of it rather than 87% of it.

### Fixed

- `gamereg amend` refuses a `--set` key the target event's type does not carry,
  at exit 2, naming the fields it does carry. Such a key was merged into the
  payload, read by nobody and reported as a success: `rating` and `difficulty`
  patched onto a `run.open` (which reads neither) and `minutes` onto a
  `run.close` (derived state) both reached a live log, one of them after the
  agent told the user a rating had been recorded.

### Added

- `run_close_event_id` on each run in `gamereg status`, beside
  `run_open_event_id` — the event an `amend` on a closing field takes. `null`
  while the run is open; equal to the opening id for a run filed by `past` or
  `import`, which carries both halves on one event.

### Changed

- `GATEWAY_MEM_LIMIT` defaults to `1g`, from `480m`. The pinned OpenClaw idles
  at ~432 MB and restart-loops at the old limit. `.env.example`,
  `compose.yml` and `docs/deploy-container.md` carry the measurements and the
  finding that the 1 GB e2-micro is no longer a comfortable target.

### Changed

- OpenClaw pinned to `2026.9.4` (from `2026.7.1-2`) and the image's Node to 24,
  which the new OpenClaw requires (`>=24.16`). gamereg's own floor is unchanged
  at 22.18, and a clean-room build on Node 24 reproduces the committed goldens
  byte for byte, SQLite included.
- `tools.exec.security` + `ask` migrated to `tools.exec.mode: "allowlist"`.
  OpenClaw 2026.8 refuses the pair when combined, which stopped the container
  at its boot-time `config patch`.
- `docker/entrypoint.sh` seeds the exec allowlist with `openclaw approvals set
  --file` instead of copying `exec-approvals.json` into place. The store moved
  into `state/openclaw.sqlite` in 2026.9, and a legacy file left behind is
  fatal at runtime rather than at boot. A legacy file from an older image is
  removed on the way.
- `docker/entrypoint.sh` runs `openclaw doctor --fix` when the saved config
  fails validation against the installed OpenClaw, and still dies if it is
  invalid afterwards. `meta.lastTouchedAt`, written by OpenClaw itself, became
  unrecognized across this upgrade and would otherwise have blocked every boot.

### Changed

- `agent/README.md` restructured: 1290 lines to 650. Architecture and the
  prompt layout first, an objective step-by-step setup that points at
  `docs/deploy-container.md` for the deployment actually in use, then decisions
  and traps as their own sections instead of essays interleaved between the
  setup steps. The chronology went; the reasons stayed. One contradiction was
  resolved on the way — the approvals section asserted both that an explicit
  `approvers` list was required and that `enabled: true` alone sufficed.

### Changed

- Check-ins carry no buttons. The three exits are typed, which makes the
  agent's `message` tool unnecessary on that turn and leaves `--deliver` as
  the only sender — so "exactly one delivery path" stopped being a rule the
  wake had to enforce and became a property of the design.

### Fixed

- `gamereg doctor` no longer reports every `session.checkin` as invalid. Its
  enum table was keyed by field name alone, so `outcome` was checked against
  the run's list (`finished|abandoned`) on check-ins too, which spend the same
  field on `snoozed|break_started|session_closed|no_reply`. The live vault
  carried eleven false positives — and they were hiding two real orphans.

### Fixed

- Check-in buttons are stripped once the question is answered. The rule lived
  in `AGENTS.md`'s *Buttons* section and the check-in flow never routed back to
  it, so a check-in answered in plain text kept its buttons live. A second
  check-in for the same session now also strips the first, and a tap naming a
  session that `gamereg open` no longer lists is answered in words rather than
  with a command that exits 5.

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
- `test/entrypoint-wrapper.test.ts`, `test/loop-wrapper.test.ts` and
  `test/phase-citations.test.ts`.
- GitHub Actions: `test` (typecheck and the suite on Node 22.18 and 24), `image`
  (builds the container, runs its entrypoint's `--dry-run`, and diffs a
  clean-room `gamereg build` against the committed goldens) and `live` (the
  opt-in IGDB suite, weekly, which now fails rather than passing vacuously when
  the credentials are absent).
- `test/dump-db.ts` — `dumpDatabase()` as a leaf module importing only
  `node:sqlite`, so the container workflow and `test/golden.test.ts` compare
  through one implementation with no `node_modules` on the runner.

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
- `AUTH_TELEGRAM=""` is no longer passed to Remark42 as an empty string.
  Presence is read as enable, so it advertised a sign-in method that then
  failed against the Telegram API. Boolean flags carry an explicit `false`.
- Every auth provider `.env.example` advertises is passed through by
  `compose.yml`. Patreon and Microsoft were offered and never wired, which,
  after the `env_file` removal, meant filling them in did nothing and said
  nothing. A test holds the two files to each other.


## [0.3.0] - Phase 3 — Check-ins, stats and the Quartz site

### Added

- `scripts/gamereg-autobuild.service` / `.timer`, so a host install can run the
  maintenance sweep on a systemd timer.
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
