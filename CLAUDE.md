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

**Phases 0–2 are done and tagged (`v0.0.0`, `v0.1.0` patched by
`v0.1.1`/`v0.1.2`, `v0.2.0`).** Phase 2's exit criterion — an entire game
logged start to finish with no terminal — has been demonstrated live end to
end, voice included: `start` through chat, a code-3 menu resolved by an
actual inline-button tap, a session closed by a voice note, `finish` with a
drafted verdict. `agent/README.md`'s *Voice* section and its smoke test
record the confirmation.

**Phase 3 is built, all five steps, and not yet tagged.** The
spec pass landed the pieces that were missing or contradictory: `quartz` as an
ordinary target (no second pass, invariant 8 intact), the check-in state machine
and who owns each transition, `checkin --expire`, a phase-3 exit criterion, and
the per-target comparator. `docs/spec/05-agent.md`, `07-targets.md` and
`06-roadmap.md` are the places to read; the *Decisions* below carry the
reasoning.

Step 1 landed the CLI half of check-ins: the `checkin` config block,
`core/due.ts` (the trigger evaluator — all three triggers, the fire-vs-deliver
split, quiet hours, the ladder, the ceiling), `gamereg due` and
`gamereg checkin`, including `--expire`.

Step 2 landed the other half, the one that lives on the gateway host:
`agent/checkin.sh` (the hourly poll — sweep, ask, exit silently, wake, file),
the cron registration in `agent/README.md`'s step 8, and `SKILL.md`'s
*Check-ins* section. `test/checkin-wrapper.test.ts` drives the wrapper end to
end against a real vault with only `openclaw` stubbed, so a renamed flag fails
in CI rather than at 04:00 on a live host. The Registrar is no longer silent
until spoken to.

Step 3 landed the reaction tokens, and landed them inert: five identifiers
(`filed`, `approved`, `archived`, `pending`, `puzzled`), a *Reactions* section in
`SKILL.md`, `agent/workspace/REACTIONS.md` as the per-installation mapping table
— emoji column filled, sticker column empty, since only the second names an asset
somebody has to obtain — and the two Telegram switches commented out in
`openclaw.example.json5`. No artwork ships and none will — the sticker set is the
user's. `test/agent-skill.test.ts` holds both halves: the token list cannot drift
between the skill and the table, and a `file_id` cannot be committed here.

Step 4 landed the `stats` target and the two renderers under it:
`render/heatmap.ts` (a year as inline SVG, no dependency, its own palette) and
`render/review.ts` (every figure a year in review carries, computed in code).
The target writes `obsidian/Stats.md`, one `obsidian/reviews/<year>.md` per year
played and the heatmap of each as a file; `html` embeds the same SVG string in
`Games.html`, which is the shared-renderer seam used twice. `CURRENT_PHASE` went
to `3` here — see the `UNBUILT_TARGETS` decision below for why `quartz` had to
be named as unbuilt for the one step between this and the next.

Step 5 landed `quartz`, the last of the phase: `render/flavour.ts` (the seam
that lets one set of emitters serve two consumers), the target itself
(`quartz/content/games/*.md`, `runs/*.md`, `index.md`, plus a seeded
`quartz/quartz.config.yaml`), `templates/quartz.config.yaml`, and
`targets/mirror.ts` — the asset hardlink pass, generalized out of `obsidian.ts`
so the site can have the files too when `images.publish` says so.
`UNBUILT_TARGETS` is empty again. The content tree in `example-vault/` was built
once by hand against a real Quartz 5.0.0 checkout: pages, wikilinks,
`description` and the embeds all land, and no link comes out broken.

What phase 3's *exit criterion* still wants is a page a stranger can open, and
that is hosting — deliberately unanswered here, see the open item below. Every
bullet of the phase is built; the last sentence of the criterion is waiting on a
deploy, not on code.

`quartz` gained the vault's Stats page and its per-year reviews after the
phase's own five steps, closing a gap `render/review.ts` had left since Step 5:
its wikilinks (`[[slug\|title]]`, `[[year]]`) were hardcoded to the Obsidian
shape rather than going through `noteRef`/`Flavour` the way `render/table.ts`
and `render/note.ts` already did. `noteRef` gained a third folder
(`'reviews'`), `reviewBlocks`/`newReview`/`statsBlocks`/`newStats` all take a
`Flavour` now, and `quartz.ts` plans `content/stats.md` plus
`content/reviews/<year>.md` and `content/reviews/heatmap-<year>.svg` — the same
renderers `stats` already used, unconditionally (this is generated data, not a
user photo, so it carries no `images.publish`-style gate). `index.md` is
untouched; the Stats page is reached through Quartz's own content-tree
explorer. Client-side JS filtering/sorting like `html`'s was raised and
declined for `quartz` specifically — see the *Decisions* entry below.

`quartz` also gained `content/Game Database.base`, the same seed
`obsidian.ts` writes, reused byte-for-byte (`template('Game Database.base')`,
no fork). This was worth checking, and checking meant running actual Quartz:
a real 5.0.0 checkout, `example-vault/quartz/` copied in, confirmed
`@quartz-community/bases-page` — already enabled in the seeded
`quartz.config.yaml`, nothing to turn on — renders a `.base` file into a
themed, sortable HTML table (`--background-primary: var(--color-base-00)`,
chained from the config's own palette, not a bolted-on look). Every property
and filter the seed uses turned out to already be flavour-independent
(`tags`, `status`, `platform`, `genres`, etc. — see the *Decisions* entry
below), so this cost nothing in `render/`.

**Vault maintenance moved off the agent, onto `scripts/autobuild.sh`.** `enrich`
and `build` used to run as backgrounded, unreported `exec` calls from
`SKILL.md` — a model turn spent deciding something that needed no deciding, on
a path that silently dropped a build whenever two session closes landed close
together (`gamereg build`'s lockfile exits 5 immediately rather than queuing,
and `SKILL.md` said to ignore a non-zero exit from either call). `gamereg
enrich --missing` (`src/cli/commands/enrich.ts`) is the piece that made an
external sweep practical — a bulk selector reading only what has no provider
reference yet, so a periodic call costs nothing when there is nothing new.
`scripts/autobuild.sh`, timed by `gamereg-autobuild.service`/`.timer` (systemd
--user, declarative, `scripts/`), polls `git status` in the vault and, when
dirty, runs `enrich --missing --covers`, then `build`, then commits and pushes.
It carries no state beyond the repository itself — see the *Decisions* entry
for why an async flag on the CLI was rejected in its place, and
`agent/README.md`'s *Maintenance moved off the agent* for the installation
steps and the `notifyOnExit` risk this closes. `test/autobuild-wrapper.test.ts`
drives it end to end, `git` stubbed, `gamereg` real, mirroring
`test/checkin-wrapper.test.ts`.

**The agent layer had an optimization pass, driven by measurement rather than
taste.** `~/.openclaw/agents/main/sessions/*.trajectory.jsonl` records the
compiled context of every turn, and it said three things. OpenClaw was exposing
**39 tools** whose schemas came to 53,768 characters against a 45,615-character
system prompt, for an agent that uses three (`exec`, `message`, `read`) — and
the transcripts showed it reaching for `sessions_history` and `memory_search`
anyway, both forbidden in prose by two files. `SKILL.md` was read **38 times**
across the archive at ~14k tokens each, because a skill body is an on-demand
`read` while `workspace/*.md` is compiled into the system prompt and cached —
which meant the persona was resident and the operating procedure was bought
again every session. And of 361 `exec` calls, `query` was 87, of which 34 hit
`FROM events` and 11 were `--schema` against only 5 on `v_finished`: the agent
hunting for event ids, which nothing but raw SQL could produce.

So: `tools.allow` in the config; `workspace/AGENTS.md` became the operating
card and `SKILL.md` a 4KB router with the rare flows in `reference/media.md`,
`corrections.md` and `checkins.md`; `run_open_event_id` and
`session_open_event_id` landed on `open` and `status`; `SOUL.md` roughly halved
with its aside allowance rewritten as positive triggers. `agent/README.md`'s
*Where the prompt lives* and *The tool surface is part of the prompt* carry the
numbers and the restart step.

`npm test` is 555 tests, all green (`node --test`, no framework, no network).
`npm run test:live` (opt-in, real IGDB calls, skips cleanly with no credentials)
adds 8.

**Phase 4 opened, ahead of board games, and its first piece is a container.**
The reorder is in `06-roadmap.md`: phase 3's exit criterion wants a page a
stranger can open, which is hosting, so the phase that makes this installable
could not sit behind the one that adds a second category of game. Board games
moved to *After 1.0* rather than to slot 5, because it is additive by design
(D6) and a release should not wait on it. Phase 4 is therefore the last
numbered phase and ships as `1.0.0`.

`Dockerfile`, `compose.yml`, `.env.example`, `docker/entrypoint.sh`,
`docker/loop.sh` and `docs/deploy-container.md` are the build. One image holds
the CLI and the gateway and serves two services, because the agent's boundary
requires `gamereg` to be a local binary and the maintenance sweep needs the
same one. The image is built from `npm pack`, not from a copied `dist/`, so it
exercises the `files` allowlist and the `prepare` hook that a real publish will
use. `docker/loop.sh` replaces `gamereg-autobuild.timer`, which has no meaning
in a container; overlap needs no guard because `build`'s lockfile and
autobuild's git-status-is-the-state design already provide one.

Two things were found by reading the real gateway rather than its docs, and
both changed the design. `openclaw cron add` is a Gateway *client* command, so
the check-in job cannot be registered by the entrypoint before the gateway it
is about to exec — it moved to a one-shot `provision` service gated on
`openclaw gateway health`. And `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH`
exist, which is what lets one mounted directory hold config, workspace, exec
allowlist, cron store and transcripts.

Two optional profiles ship alongside, both off by default: `site` (a Quartz
build loop plus Caddy) and `comments` (Remark42 behind a Cloudflare tunnel).
Neither should run on the e2-micro, and a test asserts the default profile set
stays exactly the three core services — the numbers that make the site profile
a bad idea there are invisible in a diff, and dropping a `profiles:` key reads
as tidying. The site loop watches the vault's git HEAD rather than mtimes,
because `build` rewrites derived artifacts wholesale and mtimes therefore say
nothing; and it watches rather than being triggered, because triggering would
mean the Docker socket in a container sharing a machine with a model that has
a shell.

**The image has now been built and the stack run, and doing so found seven
things reading could not.** Four were the gateway refusing to start, each with
a message pointing somewhere other than the cause: no `gateway.mode` in the
config (the shipped example was written to be patched onto a host that had
already been onboarded — in a container there is no already); a container bind
switching to `0.0.0.0` and demanding auth, which the entrypoint now answers
with a token it generates into `/config`; `gateway health` exiting 1 without
that token, which would have left the gateway permanently unhealthy and
`provision` waiting on it forever; and `openclaw onboard` being the only owner
of the model credential, absent entirely from the first draft. Two were
Compose: `${VAR:?}` in an opt-in profile breaks *every* command for everyone,
because interpolation happens before profile filtering; and `provision` needs
`network_mode: "service:gateway"`, since OpenClaw refuses plaintext `ws://` to
a non-loopback address. The seventh is the subtlest — a freshly seeded vault
must be committed, because `autobuild.sh` reads "tree is dirty" as its whole
state and never stages `gamereg.config.json`, so an uncommitted seed means
every tick forever runs an enrichment that reaches the network. Each of the
Compose ones is now a test rather than a comment.

**Deploying it to a real always-free e2-micro then found two more, and both
were the machine rather than the code.** The image declares `USER node`
(uid 1000) and compose overrides it with the host's uid so the bind-mounted
vault is not owned by a stranger; that host's uid was 1001, absent from the
image's `/etc/passwd`, so Docker fell back to `HOME=/` and `git config
--global` failed silently, aborting the vault's first commit. It had passed
locally purely because the development uid is 1000. `ENV HOME=/config` removes
the coincidence. And the health check was `openclaw gateway health`, a whole
Node process: 0.4s here, minutes there, which is longer than the 30s interval
— so the checks piled up, a dozen Node processes pushed the load average past
30, and they starved the very boot they were gating. It is a bare
`bash /dev/tcp` connect now, which spawns nothing and answers the only
question `provision` asks. **A health check that costs more than its interval
is an outage generator**, and nothing short of a slow machine surfaces it.

**Two more came from the first live conversation and the first served page.**
The agent answered like a stock assistant, with no error anywhere: the seeded
config names `~/.openclaw/workspace`, which is right on a host and resolves
beside the state directory rather than into it in the container, so the
persona and the skill were simply not found. Nothing logs that. And a Claude
Code OAuth token turns out not to be portable — the credential lives in a
per-agent SQLite auth store, so a token copied from a working host fails with
"your saved login looks expired"; OpenRouter is now a first-class primary,
which is what the fallback had silently been doing anyway. Then serving the
site found that `caddy file-server` alone 404s every internal link (Quartz
emits `stats.html` and links to `/stats`), and that the obvious `try_files`
order is still wrong, because Quartz emits both `tags/gamereg.html` and a
`tags/gamereg/` directory and the bare path matches the directory first.

**Then the `site` profile was exercised on the same machine, and four more
fell out.** A partial `node_modules` left by an interrupted install is not
self-healing and `npm install` does not repair it, so the guard became a
sentinel written after a successful install rather than the directory's
existence. Quartz removes and recreates its output directory, which a bind
mount point forbids (`EACCES: rmdir`), so it builds into its own `public/` and
the result is copied out. A named volume is root-owned while every service runs
as the host's uid, so both the output and the npm cache became bind mounts --
the symptom was npm failing to write its log directory, which names neither
ownership nor volumes. And **nothing may be mounted from the compose project
directory**: the loop script and the Caddy config were, which works in a
checkout and nowhere else, and on a machine holding only `compose.yml` and
`.env` Docker creates a directory at the missing path and the container dies
on "Permission denied" or "mount a directory onto a file". The script is baked
into the image now -- it is already a Node image, so `site-build` needs no
second one -- and the serving config is written by `site-build` into the
directory it already shares with the server. Measured: `npm install` 14s, the
Quartz build 4s, two minutes from `up` to a served page, and the whole stack
together leaves ~280 MB free.

What the container bought beyond deployment, as argued for in advance: a
clean-room `gamereg build` over `example-vault/`'s log, on a different libc,
locale and install path, came out **byte-identical** to the committed goldens.

`test/entrypoint-wrapper.test.ts` and `test/loop-wrapper.test.ts` follow
`checkin-wrapper` and `autobuild-wrapper`: real `gamereg`, stubbed `openclaw`,
`HOME` in a temp dir so `git config --global` never reaches the developer's
own. **The image itself is unbuilt and unverified** — there is no Docker daemon
on the development machine and no CI — so what is proven is the boot script,
not the Dockerfile.

## The agent layer

`agent/` at the repo root: `workspace/` (`AGENTS.md`, the operating card the
gateway keeps in context on every turn, plus `SOUL.md`, `IDENTITY.md` and
`REACTIONS.md`), `skills/gamereg/` (`SKILL.md`, now a routing table, plus
`reference/cli.md`, `query.md`, `media.md`, `corrections.md` and
`checkins.md`, each read only when its flow happens), `openclaw.example.json5`,
`approvals.example.json`, `README.md`, and `PERSONAS.md` (how the two clerks
are *drawn* — avatar prompts, visual canon, and the narrative canon that is not
operative at runtime; deployed nowhere and read by nobody at runtime,
`workspace/SOUL.md` wins any disagreement). Which half a rule belongs in is a
decision with a measured reason behind it — see *Decisions* below before moving
anything between them.

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

- **Nothing outside `06-roadmap.md` cites a roadmap phase by number.** Phase
  numbers are the one label in this project designed to move — reordering them
  is a product decision, not a rename — so a citation of one rots the moment
  the decision is taken. Found by moving distribution ahead of board games:
  `src/core/fold.ts`, `01-model.md` and `PERSONAS.md` all said "phase 4" about
  board games and all became wrong in the same commit. Say what the work *is*
  ("reserved for board games"); the roadmap owns where it sits. Same shape as
  the invariant numbering above, one layer up: a number is only safe to cite
  when something guarantees it will not be renumbered.
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
- **The target is `quartz`, not `site`, and it writes `quartz/`.** Two reasons,
  and the second is the one that would have cost something later. First, it
  matches the only precedent that fits: `obsidian` is also named for its consumer
  and also writes a whole tree into a directory of the same name. Second, a
  target that emits `quartz.config.yaml` is not a generic site builder, and
  parking it on the generic name would have left a future Astro target with
  nowhere to write — two targets planning one path is a hard error
  (`error.target_conflict`), so `site/` could never have been shared. Renamed
  before anything was implemented on purpose: `06-roadmap.md` says target names
  are free to move until phase 4 and are a migration owed to a stranger after it.
- **`quartz` generates from folded state; it is not a second pass.** An earlier
  draft of `07-targets.md` had it running Quartz over the finished vault, which
  made it "the one target that reads what the others wrote" and put invariant 8
  in permanent contradiction with itself. The fix was to make the claim false
  rather than the invariant weaker: `quartz` plans its own content from state, and
  gamereg never runs Quartz at all — it emits the input and stops. Cost: a
  flavour parameter through `render/`. Bought: invariant 8, D8 and
  non-negotiable 8 keep their absolute form, and the build still spawns no
  subprocess. Do not "reunify" this by having `quartz` read `obsidian/`; that is
  the bug, restored.
- **`quartz` gets the vault's Stats page and reviews, never `html`'s
  client-side filtering.** Both were raised together when the site's Stats page
  was built. The heatmap/review port was mechanical — `render/heatmap.ts` and
  `render/review.ts` are already pure functions of folded state, the seam
  `html` was already using — so it landed. JS filtering did not, for two
  reasons that both survive independently. First, it blurs a boundary
  `07-targets.md` draws on purpose: `html` is "one self-contained,
  JS-powered page," `quartz` is "document publisher, Markdown in, linked site
  out," and the *Astro is a possible second generator* open item below
  reserves exactly this kind of data-driven, cross-cutting feature for a
  second generator rather than folding it into Quartz's ceiling. Second, and
  more concretely, whether a `<script>` tag survives Quartz's own
  Markdown/HTML pipeline is untested by this repo — the same gap
  `quartz.config.yaml` already has ("verifying a change to it means running
  Quartz, which gamereg never does"). If it is ever wanted, the honest way in
  is the Astro path, fed a projection, not a `<script>` smuggled into
  `quartz/content/`.
- **Porting `Game Database.base` to `quartz` cost no `Flavour` field, because
  the thing it depends on was never actually a per-flavour difference.** The
  instinct going in was that `tags` — what the seed's `file.hasTag("gamereg")`
  matches — would need a fifth `Flavour` boolean the way `assets` gates
  `cover`. Reading `render/run.ts`'s `runFrontmatter()` first showed otherwise:
  `set('tags', ['gamereg', 'gamereg/run'])` has no `if` around it at all, in
  either flavour, and neither does anything else the `.base` reads (`status`,
  `platform`, `genres`, `hours`, and the rest). Only `cover` is flavour-gated,
  and it already was, correctly, through `flavour.assets` — the same gate the
  note's own header embed uses. So the fix was purely in `quartz.ts`: one more
  `files.push` with `policy: 'seed'`, reusing `template('Game Database.base')`
  verbatim. Adding a boolean for a difference that doesn't exist would have
  been exactly the "casually added fifth field" `render/flavour.ts`'s own
  comment warns against.
- **Invariant 9 stays a deletion whitelist — do not make it per-target.**
  Proposed once, on the reasonable grounds that a target knows best what its own
  artifacts are and that `.obsidian/` must survive a build. But `.obsidian/`
  already survives, precisely because the rule is a whitelist: it is not in the
  manifest, so it is never a candidate. Splitting the rule into N per-target
  policies would trade one auditable rule for N, in the only part of the system
  that deletes, and the failure modes are asymmetric — a wrong central rule
  deletes nothing, a wrong per-target policy deletes somebody's `.obsidian/`.
- **The cron wrapper files the check-in, never the agent — and after the wake,
  never before.** The anti-nagging rules are a clock and a counter, which
  invariant 7 keeps out of a model; the agent would also have to remember a
  45-minute deadline across turns, which a chat turn cannot do. Order matters as
  much as ownership: filing the snooze before the wake lands would put a session
  in backoff having never been asked, inverting the failure mode `02-cli.md`
  chose on purpose. A repeat costs one message; a false silence costs a closing
  time nobody remembers. `day_cutoff`'s exemption from the ladder and the ceiling
  is what makes the residual risk survivable.
- **A wake carries no conversation, and three things the agent normally gets for
  free are missing from it.** All three were found by watching a real check-in
  go out, and none of them fails loudly. (1) The delivery target: a turn started
  by an inbound message has the conversation's target injected into the model's
  context, a poll-started turn does not, and the agent filled the gap with
  `target: "telegram"` — which resolved to `@telegram`, the *public channel*, and
  was stopped only by the bot not being a member of it. `--reply-channel` /
  `--reply-to` put the routing back, and `SKILL.md` forbids naming a target at
  all. (2) The session: `openclaw agent` has no implicit main session and refuses
  without `--agent`. (3) The language: with nothing written, `SKILL.md`'s "reply
  in whatever they wrote" has no input, and the agent went through session
  history and memory before answering in the wrong language — so the wrapper
  states the register's configured locale as a fact. The shape of all three is
  the same, and it is worth remembering as one lesson rather than three: **the
  gateway's implicit context is a property of an inbound message, not of a
  session.** Anything the agent normally infers has to be handed to it here.
- **One delivery path per wake, never two — and the wrapper's `--at` is what
  makes that testable.** `--deliver` and the agent's own `message` tool are both
  senders, and with both on every check-in arrived twice: identical text, same
  minute, one copy with buttons and one without. Nothing generated it twice; the
  model narrated alongside its tool call, as models do, and `--deliver` delivered
  the narration. `NO_REPLY` does not help — OpenClaw matches that sentinel per
  payload, and the turn produced two. So the wrapper picks by mode: routing
  configured means the message tool sends and `--deliver` is off; no routing
  means `--deliver` carries the reply and the message tool is forbidden. The
  reason this needed a live user to find is that every artifact looked correct
  from the inside — one `message` call, one `messageId`, one `session.checkin`.
  It is only visible on the phone. Hence `--at` on `checkin.sh`: the wrapper was
  the one caller that could not use the CLI's own test harness, its first test
  was built on `Date.now()` and duly failed on the hour of day, and a script
  that cannot be pinned to an instant cannot be tested at all.
- **A scratch vault isolates the wrapper, never the agent.** The wrapper reads
  `GAMEREG_VAULT` from its own environment; the agent reads it from the gateway
  process, which is the live vault. So a check-in raised from a test vault is
  *answered* against the real one — found by a tap that opened a real break on a
  real session, undone with `revoke`. Testing the answer half means using the
  real vault, or repointing the gateway. Two things held up under it: the agent
  noticed the game did not match and went to `gamereg open` to find out why, and
  inside a single vault `break start` exits 3 rather than pick between two open
  sessions.
- **The wake is `openclaw agent`, run synchronously by the wrapper — not a
  second cron job.** A command job's output cannot trigger an agent turn, so the
  wrapper has to raise it. The one-shot `cron add --at +0s --message` written
  down as the candidate does work, but it refuses to deliver without an explicit
  `--channel`/`--to`, which would put a Telegram chat id inside the file phase 4
  is supposed to generate. `openclaw agent --agent <id> --message-file <f>
  --deliver` runs in that agent's main session and delivers over its own
  channel, so the question lands in the same conversation the answer will arrive
  in — which is what makes the reply reach an agent that knows what it asked. It
  does still need `--reply-to` for buttons, so one chat id ends up in the cron
  job's environment after all; what it avoids is a second job and a second
  delivery configuration. Being synchronous is a bonus, not a
  cost: the snoozes are filed only after the wake returns 0, so a gateway that
  was down leaves the session eligible next tick instead of silently in backoff.
- **The wrapper's stdout is empty on every path, and `GAMEREG_SOURCE` is set
  rather than inherited.** Both were found by probing the live gateway, not by
  reading its docs. A cron command job's `delivery.mode` defaults to `announce`,
  so anything on stdout is one missing `--no-deliver` away from being sent to the
  user as raw text — diagnostics therefore go to stderr, where
  `openclaw cron runs` still shows them. And a command job inherits the gateway
  process's environment, which here includes `GAMEREG_SOURCE=chat`: left alone,
  every check-in the poll files would claim in the log to have come from a
  conversation.
- **The agent reads `last_checkin_id` off `gamereg open`; it is never handed the
  id.** `02-cli.md` used to say the id "comes back in this command's own
  `result.checkin_id`", which is true for the wrapper and impossible for the
  agent — the wake is enqueued *before* the check-in is filed, so at the moment
  the question reaches a conversation the record does not exist. Putting the
  field on `open`'s row is the smallest fix that survives a context compaction
  and a gateway restart. Its one sharp edge is in `SKILL.md`: `open` lists open
  sessions, so an answer that closes one has to read the id first.
- **`due` returns at most one row per session, and `day_cutoff` outranks the
  other two.** Several triggers stand fired at once far more often than the
  state machine's per-trigger reading suggests — a session open past 4h at
  09:00 the next morning has all three — and returning them all would file
  three check-ins and send three messages about one session, which is the
  nagging the whole feature is built to avoid. The priority follows what each
  trigger is *for*: `day_cutoff` chases data nobody has, `duration` knows how
  long the session ran, `clock` only knows what time it is. Two consequences
  worth keeping straight: the ladder is measured from the last check-in of any
  trigger (a chase is still a message that just arrived), while the ceiling
  counts only `duration` and `clock`, because `day_cutoff` has its own budget.
  What bounds a trigger exempt from both is that it is asked once per delivery
  slot — one chase per morning, and a session open for three days is chased
  three times, not hourly.
- **Quiet hours are evaluated against *now*, not against the moment the trigger
  fired.** Both noticing triggers stay fired once crossed — a threshold does not
  un-cross itself — so "held, not dropped" needs no queue and no state: a
  trigger withheld at 03:00 is simply returned at 09:00, where it merges into
  the morning message. Evaluating the fire instant instead would let a trigger
  that fired at 01:00 and was held by backoff until 03:00 be delivered inside
  the quiet window, which is the one thing quiet hours exist to prevent.
- **The hourly poll is a cron *command*, not a heartbeat or an agent turn.**
  `due` already decides whether there is anything to say, so the caller must stay
  dumb — and a command payload runs the binary with no model attached, making an
  empty poll free. A heartbeat would ask a model to re-decide what the CLI
  decided, and it is already in use here for something else: `notifyOnExit` can
  wake the agent when a backgrounded `exec` call finishes — the button-strip
  edit in *Confirmations* is one such call — which is why
  `agent/workspace/AGENTS.md` tells it to answer `HEARTBEAT_OK` and stop rather
  than improvise a comment about whatever just finished.
- **No external service is integrated, and the near miss is worth remembering.**
  HowLongToBeat and Backloggd have no official API; Steam and console playtime
  are the deferred *automatic playtime detection* and the *not a library manager*
  non-goal, so they are a product question and not a scope one. IGDB's
  `game_time_to_beats` was genuinely cheap — same credentials, same client, one
  extra query — and was still declined, because it needs a new `game.enrich`
  field and a phase does not buy a schema change for a nicety. If it is ever
  wanted, that is the only candidate worth reopening.
- **`example-vault/` carries two real, never-regenerated WebP assets** — a
  golden test for rendering never touches the encoder, only the event log and
  string arithmetic, so `sharp` version drift can't move the hash.
- **A reaction is a second tool call and the mapping is a workspace file, and
  both were forced by what OpenClaw actually has.** The spec said the mapping
  "lives in the user's config"; on 2026.7.1-2 there is no config slot for it —
  `MessagePresentationBlock` is `text | context | divider | buttons | select`,
  with no sticker or reaction member, so a reaction cannot ride along with a
  reply the way an inline keyboard does, and OpenClaw's own config schema has
  nowhere to put a token table the model would read. What exists is
  `action: "sendSticker"` (needs a `fileId`) and `action: "react"` (needs a
  `messageId` and an emoji), each behind its own switch, both off by default.
  So the table went to `agent/workspace/REACTIONS.md`, which is the gateway's
  side of the line and copied per installation — the part of the original claim
  that mattered was *not in the register's config and not in its log*, and that
  is intact. One consequence the model has to be told about, because it is not
  inferable: an emoji reaction is *on* a message, so with no concrete message id
  in hand the correct move is to react with nothing.
- **The five tokens are identifiers and are never translated — say it wherever
  they are written down.** Four of them (`filed`, `approved`, `archived`,
  `pending`) collide by name with the persona's localized vocabulary, which is
  prose served by `gamereg vocab`. A translated token matches no row and the
  reaction silently does not happen, which is indistinguishable from a correct
  empty installation. That is why the warning is repeated in the spec, in
  `SKILL.md` and in `agent/README.md` rather than written once.
- **`CURRENT_PHASE` is a phase, and `UNBUILT_TARGETS` is the step.** Bumping the
  phase to 3 for `stats` also made `quartz` pass the vocabulary's gate, which
  would have turned a clean "arrives in phase 3, this version builds through 2"
  into an exit 1 from the registry at build time — later, vaguer, and after the
  vault already declared it. A phase is delivered in steps, so a target can be
  current and unbuilt at once; `UNBUILT_TARGETS` in `core/vocab.ts` names those,
  `checkTarget` refuses them at exit 2 where they are *named* (so `init` and the
  config reader both catch it), and `test/targets.test.ts` asserts the list plus
  the registry accounts for `BUILD_TARGET` exactly once, so it cannot rot. Empty
  is its normal state — a target lands and leaves the list in one commit, as
  `quartz` did — and `test/init.test.ts` therefore asserts the rule over
  whatever it holds rather than over one name. The
  registry's own `unimplemented_target` throw stays as the backstop and became
  `usage` for the same reason.
- **A year in review reads no clock, and that is a rule about the log, not
  about formatting.** Which years exist comes from sessions in the log; a year
  is always drawn whole, January to December. The temptation is not
  hypothetical — "year in review" reads like an invitation to call `Date.now()`
  — and the cost of giving in is that a build in December and a build in
  January disagree, which is non-negotiable 2 broken by a feature nobody would
  think to test for it. `test/stats-target.test.ts` builds a log whose only
  sessions are in 2019 and asserts exactly one review note.
- **Hours in a year are measured hours, and the gap is the point.** A session
  has a logical day; stated hours from `import` or `--hours` belong to a run and
  to no day, so they count in the totals and in a game's note and not in a year.
  A migrated register therefore shows years emptier than they were, which is
  true: nobody recorded those days. Do not "fix" this by spreading a run's
  stated hours across its date range — that invents days.
- **The heatmap is a string, not a file, and the target decides which.**
  `heatmapSvg()` returns SVG; `stats` writes it to
  `obsidian/reviews/heatmap-<year>.svg` and embeds it, `html` pastes it inline.
  The embed is a Markdown image with a path relative to the note's own folder,
  which is the one spelling Obsidian, GitHub and a static site generator all
  resolve identically — a wikilink embed is Obsidian-only, and inline SVG inside
  Markdown is stripped by GitHub's sanitizer. Fixed level thresholds rather than
  per-year quantiles, so two years can be read side by side.
- **The prose half of a review has no command, on purpose for now.** The agent
  may draft the opening paragraph the way it drafts a verdict, but it writes no
  files and there is no `review` command, so an accepted paragraph is text the
  user pastes outside the markers. Filing it would need a new event type — a
  schema change bought for a nicety — and the argument that puts a verdict in
  the log (it is the record's opinion of a playthrough) does not obviously carry
  to a year, which is a view over the record rather than a thing in it. If the
  pasting is what stops the feature being used, that is the evidence that
  reopens it.
- **A flavour is a record of answers, not a name — and `render/` never asks
  which consumer it is serving.** `render/flavour.ts` carries four booleans
  (site frontmatter, assets present, folder-qualified links, a place for
  prose); the emitters read those and never branch on `flavour.name`. The
  reason is that every difference then has to be stated as a property of the
  consumer rather than as a preference, which is what kept the list to four and
  what keeps a fifth from being added casually. The Obsidian output not moving
  by a byte is not a hope, it is `example-vault/`: the golden files are the
  proof, and the refactor landed with them untouched.
- **A site wikilink names its folder; the vault's does not.** Obsidian resolves
  `[[hollow-knight]]` by shortest match anywhere in the vault, and Quartz
  resolves a wikilink from the content root by default (`markdownLinkResolution`,
  which the user may later set to anything). `[[games/hollow-knight]]` is the
  one spelling both accept — it is exact under `absolute` and falls back
  correctly under `shortest` — so the content does not depend on a config key
  gamereg seeds once and never owns again. Do not "simplify" this by seeding
  `shortest` and emitting bare names; that makes every link in a committed tree
  hostage to a file the user is invited to replace.
- **The front page is `index.md` on the site and `Game List.md` in the vault,
  and the asymmetry is the point.** `index` is Quartz's landing page and says
  nothing in Obsidian's quick switcher, which shows a basename; `Game List`
  reads well there and is not a landing page anywhere. Same block, same
  renderer, two names because two readers.
- **The seeded `quartz.config.yaml` is Quartz's own `obsidian` template,
  vendored, not a minimal config written here.** A hand-written `configuration:`
  block was tried first and Quartz 5 failed to emit from it — `theme` has no
  deep default, so a partial config is not a smaller config but a broken one.
  The template that ships is the one whose link resolution and Obsidian-flavored
  Markdown already match what this target emits. It is a `seed`, so it is the
  user's the moment they touch it and `npx quartz create` may replace it
  wholesale; that is what makes vendoring it cheap rather than a maintenance
  debt. Verifying a change to it means running Quartz, which gamereg never does.
- **`images.publish` is rendered, not merely obeyed.** With it off the site says
  where a picture was withheld instead of embedding one that is not there, and
  the run note's `cover` property is omitted rather than pointing at a file the
  tree does not hold. With it on, `targets/mirror.ts` hardlinks the assets into
  `quartz/content/assets` — the same add-only pass `obsidian/assets` gets, which
  is why it lives outside the manifest and is not a planned file. The two halves
  have to move together: rendering the embed without the mirror is a broken
  page, and mirroring without rendering is dead bytes.
- **An example import mapping lives in the guide, not in `templates/`.**
  `templates/` is for what gets seeded into every vault (`Game Database.base`,
  `quartz.config.yaml`); a mapping file names one spreadsheet's own column
  headers, which are different for every user and often for every export. A
  shipped example would be copy-pasted with headers that don't match anyone's
  actual CSV, which is worse than no example — `docs/getting-started.md`'s
  *Coming from a spreadsheet* section carries the worked mapping as a code
  block instead, next to the CSV it maps and the `--dry-run` output it
  produces, where the three stay readable as one unit.
- **`import`'s `verdict` field files a second event, not a second column on
  `run.import`.** `run.verdict` already exists as its own event type for
  exactly this reason (`01-model.md`: the note is what the run says about
  itself, the verdict is the considered opinion, written separately because it
  usually arrives later) — a migrating register's review column is that
  considered opinion, so `import` stages `run.verdict` against the row's own
  `run_id` alongside its `run.import`, through the same `stage` helper
  `verdict.ts` uses. No change to `run.import`'s payload shape.
- **Vault maintenance is a periodic external script, not a self-backgrounding
  CLI flag.** `SKILL.md` used to have the agent fire `gamereg enrich` and
  `gamereg build` as backgrounded, unreported `exec` calls; the alternative
  considered in its place was teaching `enrich`/`build` themselves to fork and
  return immediately, so the CLI backgrounded itself instead of relying on the
  `exec` tool's `background` param. Rejected against invariant 5
  (`00-architecture.md`): `enrich` is kept the one command that reaches the
  network, synchronous and separate, precisely so a caller — a test, a script,
  a person reading the exit code — has one observable point where "did this
  succeed" is actually knowable. A self-backgrounding `enrich` returns before
  that point exists, which is the same failure the old "ignore non-zero exit"
  rule in `SKILL.md` already had, just moved one layer down into the binary.
  `scripts/autobuild.sh` keeps every `gamereg` call it makes fully synchronous
  and backgrounds only itself, as a periodic external process (systemd --user
  timer) — the boundary invariant 5 draws stays exactly where it was. One
  side effect worth naming: `tools.exec.notifyOnExit` (`agent/README.md`) was
  an open risk because a background `enrich`/`build` finishing could enqueue a
  heartbeat and wake the agent to comment on it unprompted. With no background
  `exec` calls left in `SKILL.md` at all, that risk did not get fixed, it
  stopped applying — nothing there needed a config change.

## Open items

- **Gaby has no `SOUL.md`.** She is drafted only inside Veronika's
  (`agent/workspace/SOUL.md`) — a name, a closed tabletop counter, and a
  relationship — so that the board-game agent inherits a settled character
  instead of inventing one late. Her own persona files land with board games,
  which is now after 1.0 rather than before it, and
  the two personas have to agree: she is Veronika's inverse, warm and
  physically clumsy but *immaculate in the register*, and she calls Veronika
  "V". Until then her counter stays closed, which is deliberate — the fiction
  and the roadmap say the same thing, so the agent cannot offer a board-game
  capability that does not exist. `agent/PERSONAS.md` holds the visual canon
  her text will have to agree with, and which details are canon rather than
  set dressing.

- **Packaging and first-run setup are phase 4, deliberately last.** The shape
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

- **How the Quartz site actually gets built is deliberately unanswered.**
  `quartz` emits `quartz/content/` and a seeded `quartz.config.yaml`; running Quartz
  is the user's business, and phase 3 ships no GitHub Actions workflow even
  though `06-roadmap.md` lists one. Two reasons to leave it open rather than
  guess: the roadmap bullet is satisfied by documenting a workflow as much as by
  shipping one, and "how this thing runs on a host" is exactly what phase 4
  decides for everything else — the container image, the config generator, the
  cron wrapper below. Deciding it twice, in two phases, is how the two answers
  end up disagreeing. Nothing is stranded by waiting: `quartz/content/` is
  committed, so whoever writes the workflow later needs Quartz and nothing else.
  Shipping Quartz in the phase-4 image is the other half of the same question,
  and the container answered the *hosting* half without answering the build
  half: the default topology builds the site off-box, because an e2-micro is
  1 GB of RAM against a Quartz build's 400-700 MB peak and 1 GB of egress a
  month against a vault's worth of cover art. The vault is already pushed by
  `autobuild.sh`, so building from that repository costs the machine nothing.
  A local `site` profile is still wanted for installations with no external
  account, and is not built yet.
  `scripts/vendor-quartz.sh` exists as *a* manual path that has been run
  against a real vault and a real Cloudflare Workers deploy — it is not the
  phase-4 answer, just a documented recipe for anyone who wants a working
  site before phase 4 decides packaging for everything at once.

- **`agent/checkin.sh`'s deployment is answered in the container and nowhere
  else.** The image places it at `/usr/local/bin/gamereg-checkin` and the
  one-shot `provision` service registers it. The registration could not go where
  it looked like it belonged: `openclaw cron add` is a Gateway *client* command,
  so the entrypoint cannot run it before the gateway it is about to exec, and
  OpenClaw's config schema still carries no `cron.jobs` array — the job store is
  reachable only through the CLI, against a running gateway. Hence a service
  gated on `openclaw gateway health` rather than a step in the boot script.
  What remains open is a host install: someone following `agent/README.md`
  still registers the job by hand, and the generator will have to do the same
  for anyone not using the image.

- **Astro is a possible second generator, and it would be fed data rather than
  Markdown.** Not instead of Quartz — alongside it, which the `site` to `quartz`
  rename already made room for. The principle behind the shape: Quartz is a
  document publisher (Markdown in, linked site out) and Astro is a framework
  (data in, whatever you design out). Feeding Astro the Quartz flavour would cap
  it at Quartz's ceiling, because a page can then only show what the frontmatter
  carries — and the interesting fields are already structured. With data, gamereg
  says what is true and the site decides which pages exist, which also stops
  gamereg from deciding a downstream site's URL structure. Cross-cutting pages
  (by year, genre, platform) and any chart then need no new artifact. The `html`
  target is the precedent: it already embeds JSON and builds its table in the
  browser.

  **`data/export.json` is not that artifact and must not be widened into it.**
  Worth knowing before someone re-derives it: the file exists, is committed, and
  07-targets.md describes it as being "for the site" — but it carries no cover,
  no genres, no platforms, no `run.note` and no `verdict`, which is most of what
  a site would want. That is not an oversight; its contract is to mirror the
  SQLite tables column for column, and genres and platforms live in join tables
  the flattening drops. Widening it breaks what makes it useful to a spreadsheet
  and contradicts 04-derived.md's rule that the SQLite schema wins any
  disagreement. So an Astro path needs its own nested projection — game with its
  platforms, genres, cover and runs, each run with its verdict, note and
  sessions. That target is *cheaper* than the Quartz one, not dearer: no remark,
  no frontmatter, no markers, no splice, just a projection. Field names still
  come from the SQLite schema, which stays the authority.

  Nothing is scheduled. Build the site before the target — the shape of the
  projection is the risky part and the only thing that de-risks it is a real
  consumer, which is the same lesson phase 0's exit criterion encodes.

- **`/usr/bin/gamereg` points into this checkout's `dist/`, on purpose.** So
  `npm run build` changes what the live agent runs, the instant it finishes —
  including mid-conversation. That is the point: it is what makes it possible to
  test a change against the real gateway, on a real phone, without a release
  step. Do not "fix" it into a copy. Two consequences to keep in mind rather
  than design around: a stale `dist/` means the live agent is running old code
  while the repository looks current (`agent/README.md` opens with this trap for
  a reason), and a build mid-session can change behaviour under a conversation
  already in progress. Revisit only in phase 4, where an image pins CLI, gateway,
  skill and persona together and this stops being one person's machine.

- **What is always in context and what is read on demand is a deployment fact,
  not a taste, and the original layout had it backwards.** OpenClaw compiles
  `workspace/*.md` into the system prompt once and caches it; a skill body is a
  `read` tool call paid for mid-turn, per session. `SOUL.md` was therefore
  resident on every turn while `SKILL.md` — the actual procedure — was bought
  again each session at ~14k tokens, sometimes twice in one conversation. The
  fix was not to shorten anything first but to *move* it: the common path into
  `workspace/AGENTS.md`, the rare flows into `reference/*.md` that only load
  when that flow happens. Do not "simplify" this back into one big `SKILL.md`;
  the split is the whole mechanism, and `test/agent-skill.test.ts` asserts that
  every routed reference file exists and every existing one is routed to, so a
  file cannot be orphaned silently.
- **A tool schema outranks a paragraph — enforce a boundary with `tools.allow`,
  not with prose.** `AGENTS.md` and `SKILL.md` both forbade reading session
  history and keeping notes, in bold, and the live transcripts still show
  `sessions_history` seven times and `memory_search` three; the latter came
  back with a broken-index error carrying its own instructions for the model to
  relay to the user. Thirty-nine tool schemas were also ~13k tokens per turn
  for an agent that uses three. The lesson generalizes past this repo: when a
  rule and an affordance disagree, remove the affordance. The gateway needs a
  restart for `tools.allow` to take effect — there is no config-reload path.
- **`amend` and `revoke` take event ids, so the commands that hand out ids must
  hand out event ids.** They did not, and the gap did not read as one: the
  agent was told to write SQL against `events` with `json_extract`, which cost
  a `query --schema`, a guessed column, a failure (`no such column: opened_at`)
  and a retry on every single correction. `RunState`/`SessionState` now carry
  `open_event_id` and `open`/`status` expose it, following the pattern
  `CheckinState.event_id` already set. It is a derived field on folded state,
  not a schema change — `01-model.md` is untouched — and it is deliberately
  *not* on `due`'s row, because a check-in question never amends a run or a
  session and widening every wake payload for a caller with no use for it is
  the wrong trade.
- **A persona's aside allowance has to be stated as when it *does* apply.**
  `SOUL.md`'s rule was a list of exclusions ending in "never while something is
  in flight" — and in this deployment nearly every turn is a command in flight,
  so the net allowance was about zero. Measured: across a full recorded session
  (start through verdict) the register's vocabulary landed everywhere and the
  fiction appeared exactly once. ~60% of the file was also example lines
  labelled "not to be used verbatim" plus prohibitions, and a long list of ways
  to get it wrong makes emitting nothing the safest move. The rewrite names
  three positive slots — conversational opener, after a completed write that
  needs no follow-up, after a real error's real explanation — of which the
  second is the most common turn of the working day and was previously read as
  excluded. Non-operative canon went to `agent/PERSONAS.md`, which is already
  declared deployed nowhere and read by nobody at runtime.

- **A workspace file cannot be deleted, only replaced.** `workspace/TOOLS.md`
  was removed once `tools.allow` made its content structurally true, and
  OpenClaw seeded its own default back within the hour — a generic page about
  camera names, SSH hosts and TTS voices, which then sits in the system prompt
  every turn describing capabilities this deployment does not have. The slot is
  occupied either way; the only choice is by what. The file is back, short, and
  says this in its own header so the next session does not re-derive it.
- **The prompt may mirror an authority, but only with a test holding the
  mirror to it.** `reference/query.md` used to list the four views and no
  tables, on the stated grounds that `--schema` is the authority and a copy
  would drift. What happened instead is that the agent, wanting a table no view
  covered, invented `FROM v_sessions` — a name adjacent to the real
  `v_sessions_by_day` — and the exit 2 reached the user's chat. Withholding the
  list did not prevent a wrong name, it guaranteed a guessed one. The list is
  there now and `test/agent-skill.test.ts` parses `SCHEMA_SQL` and compares,
  the same trade `reference/cli.md` already makes against the real binary.
  **The saving is not in bytes and it is worth being accurate about that**:
  `query --schema --json` returns 2,900 bytes, against ~2,600 that the column
  lists added to `reference/query.md` — near enough a wash, plus a test and a
  maintenance obligation that did not exist before. What justifies it is
  *where* the bytes land. `query.md` is read only on a turn that asks a
  question, and such a turn needs column names by definition, so they are never
  dead weight there — unlike anything in `workspace/`, which is paid on every
  turn including "Pausa". If `query.md` keeps growing the arithmetic flips and
  `--schema` wins again.
  Two alternatives were measured and declined, and the reason is the same for
  both: **a wrong guess is not merely a wasted call, it is a failed-exec
  warning on the user's screen**, and this gateway shows one for every non-zero
  exit. Telling the agent to call `--schema` first costs a round trip on every
  question turn (the call itself is ~210ms, indistinguishable from any other
  query — it is Node startup, not the schema — against a ~10s median turn, so
  the cost is the model's extra step, not the CLI's). Attaching the available
  table and view names to `query`'s own error envelope, the way code 3 carries
  `candidates[]`, is cheaper still and cannot drift — but it only helps *after*
  the error, which is the part the user actually objects to. Prevention beat
  recovery here on that ground alone. **Reopen this if wrong names keep
  reaching chat anyway**; that is the evidence that documenting them did not
  work, and the error-envelope change is then the first thing to build.

- **A payload shown as a fragment gets a wrapper invented around it.**
  `AGENTS.md` showed the button `presentation` object alone — accurate, and
  accurate is not sufficient. The agent inferred the `message` send it belongs
  in, which was right, and then filled that send's `message` field with the
  literal string `"placeholder"` while writing the real question as narration
  that went nowhere: perfect buttons, no question. Only `action` is required by
  the tool schema, so nothing forced the filler either way. Examples in the
  always-loaded card are now whole calls rather than the interesting part of
  one, and `test/agent-skill.test.ts` asserts the button example keeps its
  `action`, its `message`, and a real sentence in it. This is the cost side of
  compressing a 56KB skill: the old file taught the pattern by modelling it
  three times over (candidates, check-ins, confirmations), and a single
  compressed statement of the same rule left one degree of freedom the model
  used.

- **Fixing half a reference leaves the other half to be found the same way.**
  `reference/query.md` was given the tables and their columns after the agent
  invented `FROM v_sessions`; the views kept their prose one-liners, and the
  next hard question produced `SUM(minutes)` over `v_sessions_by_day` — a view
  that is already aggregated and carries `hours`. Same class, same cost, one
  release apart. When a gap like this is closed, close it across the whole
  reference, not across the instance that was reported. The test now asks
  SQLite instead of parsing SQL: `SCHEMA_SQL` into an in-memory database,
  `pragma_table_info` back out, compared with the file — the same "ask the
  database, do not remember" rule the file preaches to the agent.

- **A correction states the rule; the incident goes in `agent/README.md`.
  This is the discipline that keeps the prompt from re-growing, and it was
  learned by re-growing it.** Three consecutive live bug fixes each landed a
  paragraph of "seen live: ..." narrative into the always-loaded card, and the
  card went from 10,999 bytes to 13,616 — putting back a third of what cutting
  `SOUL.md` had saved. No single addition was wrong. That is the whole point:
  it is the same mechanism that grew `SKILL.md` to 56KB, and it is invisible
  per-commit and obvious only in aggregate. The story of how a rule was found
  is worth keeping and belongs in the deployment log, which people read and
  models do not.
  Two mechanisms enforce it now. `test/agent-skill.test.ts` asserts the total
  size of `agent/workspace/*.md`, so the ceiling is a number in a diff rather
  than an intention; and the routing table lives in the card, which is free,
  rather than in `SKILL.md`, which costs a read — leaving `SKILL.md` at 865
  bytes and unread in the common case. When the budget test fails, the order of
  questions is: what comes out, does this belong in a `reference/` file instead,
  and only then should the number move.

- **The deployed prompt may not cite a repository path.** `SKILL.md`, `SOUL.md`,
  `AGENTS.md`, `REACTIONS.md` and `reference/cli.md` all pointed at
  `docs/spec/*` or `test/*`. The agent's workspace is `~/.openclaw/workspace/`
  and holds copies, not a checkout; nothing in its context names the repository
  at all. Across the whole session archive it never once tried to read one of
  those paths — but it *does* guess paths when unsure, including seven reads of
  `/home/claude/.openclaw/...`, a home directory that does not exist on this
  host. So the citations were inert at best and an invitation to a failed read
  at worst. What was worth keeping is the *claim* they carried — "these flags
  are verified, trust them" — restated without a path. The general rule: a
  deployed file addresses the model; the reason a rule exists addresses the
  maintainer and belongs in `agent/README.md` or here.

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
- **Before finishing any change that adds or alters a capability, re-read
  `README.md`'s *Status* and `docs/getting-started.md`.** Every other document
  has an obvious owner and gets updated: a spec by the change that implements it,
  `CHANGELOG.md` by habit, this file's *Current state* because the work is
  described here. Those two belong to nobody, so they are the two that go stale,
  and they are the front door — `README.md` in particular states what the tool
  can and cannot do today, which means a stale line there is not merely
  incomplete, it is false. Phase 3 proved it: four sessions each updated their
  own documents correctly and left the README saying the Registrar "stays silent
  until spoken to" two steps after it stopped being silent. Ask specifically
  whether any sentence in either file is now untrue, not whether they mention
  the new thing.

## Versioning

SemVer tied to the roadmap phases, not to feature-by-feature bumps: `0.0.0` was
phase 0, `0.1.0` phase 1, `0.2.0` phase 2, and phase 3 is `0.3.0`. A patch
(`0.x.1`) is a bug fix within an already-tagged phase.

**Phase 4 is the last numbered phase, so it ships as `1.0.0`, not `0.4.0`** —
its development window is `1.0.0-dev`. That is not a flourish: phase 4 is the
one that makes the tool installable by a stranger, and `1.0.0` is what tells a
stranger the contracts are safe to depend on. The two statements are the same
statement, so they get the same number. Board games sits under *After 1.0* in
`06-roadmap.md` and lands as `1.1.0`; it was moved out of the numbered sequence
precisely so it could not hold the release hostage.

**A phase under development carries a `-dev` suffix** (`0.3.0-dev`), the SemVer
prerelease identifier — dropped only in the commit that gets tagged. Phase 2
shipped without this and `gamereg --version` read `0.2.0` for a stretch where
nothing had actually been released under that name, patched over at the time
with a one-off note in this file instead of a convention. `-dev` replaces that
note: `--version` now tells the truth about whether the binary in hand is a
tagged release, with no per-commit bookkeeping (no `-dev.1`, `-dev.2` — the
suffix alone carries the meaning, since gamereg is installed from source or a
tagged image, never pulled mid-phase by version number).

To tag a finished phase or patch:

1. Commit the work as normal.
2. Drop the `-dev` suffix: bump `version` in `package.json` **and**
   `package-lock.json` to the plain `0.X.Y` (`npm version 0.X.Y
   --no-git-tag-version`), and move `[Unreleased]` in `CHANGELOG.md` to a new
   `[0.X.Y]` section (Keep a Changelog format —
   `Added`/`Changed`/`Fixed`/`Removed`, one line per item, no narrative). One
   commit, since both describe the same boundary: this is the commit that
   becomes the release.
3. `git tag -a v0.X.Y -m "..."` on that commit. **The message is also the
   release notes** (step 5) — write it as such, not as a label. See `v0.0.0`
   for the shape. This is the terse index; the tag message stays the detailed
   version, and `CHANGELOG.md`'s own header explains that split so a reader
   lands on the right one.
4. Open the next phase's development window: bump `version` again, to
   `0.(X+1).0-dev`, as a separate commit right after the tag. `--version` never
   again claims a release that has not happened.
5. `git push && git push --tags`, then
   `gh release create v0.X.Y --title "v0.X.Y — <summary>" --notes-from-tag`.
   `--notes-from-tag` keeps the description in exactly one place. GitHub marks
   the most recently *created* release "Latest", so backfill oldest first.

Only tag once the phase is actually done. **Never tag or push without being
asked** — versioning is user-triggered here, never done alongside unrelated work.

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
