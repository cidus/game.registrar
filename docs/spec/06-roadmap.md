# 06 — Roadmap

Each phase ends with something usable. No phase depends on the next one existing.

## Phase 0 — The register, no AI

**Goal:** prove the data model by living in it for two weeks, from a terminal.

- Event log: append, fold, validate
- `start`, `end`, `break`, `finish`, `drop`, `past`, `open`, `status`, `verdict`
- Local-only resolution (steps 1–5 and 7 of the resolution order)
- `build` as a target registry, with ownership tracking
- `obsidian` target: game notes, run notes, `Game List.md`, seeded `Game Database.base`
- `csv` target: runs, sessions, games
- Golden-file tests, idempotency test, `doctor`

**Deliberately absent:** network, providers, SQLite, agent, site, image
ingestion. Image ingestion needs no network, but it shares a dependency
(`sharp`) and a command (`cover`) with enrichment, and splitting them bought
nothing — moved to phase 1 below.

`csv` and the Bases seed are here rather than in phase 1 for one reason: the exit
criterion is two weeks of *looking* at the data, and a static Markdown table is
not something you can look at from an angle. They cost little and they are what
makes the trial produce an opinion instead of a shrug.

**Exit criterion:** two weeks of real use with no manual file edits and no
arithmetic that had to be corrected. If the model is wrong, this is when it is
cheap to find out — and an agent built on a wrong model just produces wrong data
faster.

## Phase 1 — Metadata and querying

- `providers/igdb.ts`
- `enrich`, cover download via `sharp`
- Image ingestion: `--photo`, hashing, normalization, EXIF strip, `attach`, `cover`
- Provider search in resolution (step 6), alias learning
- `sqlite` target + documented views + `query`
- `json` and `html` targets
- `import` for spreadsheet migration

**Exit criterion:** a new game gets a cover and metadata without typing anything,
and "how many hours did I spend on RPGs in 2026" is answerable with one command.

## Phase 2 — Chat and voice

- OpenClaw on the always-on host, Telegram channel, sender allowlist
- Agent prompt: message → CLI invocation
- Code 3 rendered as inline buttons
- Voice transcription upstream of the CLI
- Verdict drafting offered on finish — the command already exists and already
  accepts prose the user wrote; the agent adds a draft to accept or refuse

**Exit criterion:** an entire game logged start to finish without opening a
terminal once.

## Phase 3 — Proactive and public

- `due` + `checkin` + cron, with all three triggers and the backoff ladder
- Reaction tokens and per-installation sticker mapping
- Quartz site, GitHub Action on push
- Calendar heatmap, year-in-review generation

## Phase 4 — Board games

- `person` and `play.record` events
- BoardGameGeek provider (XML API v2), or the existing BGG MCP for the agent
- Play-centric notes: players, scores, winner, duration
- Per-person statistics

The model already accommodates this (D6). If phase 4 requires a schema migration,
something went wrong earlier.

## Phase 5 — Someone else's machine

**Goal:** the tool installs, configures itself and runs on a machine its author
has never touched.

- Published package; the install path in `docs/getting-started.md` reduced to one
  command
- A container image carrying the CLI, the gateway, the skill and the persona at
  versions known to work together
- A generator that emits the declarative configuration — compose file and
  environment — and never becomes part of the runtime
- `targets --json`, and whatever else the generator would otherwise hardcode; see
  D9 in [00-architecture](00-architecture.md)
- First-run configuration as a conversation: a second skill with its own binary,
  which leaves the PATH and the exec allowlist once setup is done

Last for a reason that is not effort. Publishing is a one-way door — a tag can be
unpublished, a vault on someone else's disk cannot. While config keys,
environment names, vault layout and target names can still move, each one is a
migration owed to a stranger. The phases above are where those contracts settle.

The pressure this phase puts on *Explicitly deferred* is real and does not change
it: an installer reaches people who will never open a vault in Obsidian, and a
web UI is what they will ask for. `html` and `site` are the answer; a server with
accounts is still not.

**Exit criterion:** someone who has never seen this repository installs it and
records a session — without cloning anything, and without being told anything
that is not in the generated README.

## Explicitly deferred

- Multi-user anything
- Web UI
- Automatic playtime detection from Steam or consoles
- Mobile app
- Sync — git is the sync

## Decided

1. **Cover and screenshot licensing for the public site.** Not needed. This
   vault is for personal use; the site is a maybe-someday extra, not the point
   of the tool. `images.publish` and `images.publish_covers` collapse into one
   switch, `images.publish` (default `false`) — see [04-derived](04-derived.md).
2. **Multi-platform runs.** `platform` stays on the run. It was never moved to
   the session and phase 0 gave no reason to.
3. **Franchise / series grouping.** Deferred past Phase 1. Real usage will show
   whether it's actually wanted before the model or the provider mapping is
   committed to.
4. **Timezone changes while travelling.** Nothing to build; the transparent
   behaviour was already there. `logical_day` is derived on every fold, and
   `config.timezone` picks which of two coherent readings applies: unset — what
   `init` writes — groups a session by the local day where it was recorded,
   using the offset already in the log, and a zone projects everything into that
   zone. Both are stable under travel and neither asks anything of the user; the
   machine's clock moving is a non-event either way. What does rewrite the past
   is editing `config.timezone`, which re-projects every instant at once. See
   [01-model](01-model.md)'s *Logical day*. A per-invocation override was
   considered and rejected: the register would group by which device filed an
   event, and detecting a phone's zone through the chat gateway cannot help,
   because the CLI runs on the always-on host that stayed home.
5. **A backlog view.** No. The register holds what you played, per the non-goal
   in [00-architecture](00-architecture.md) — it does not know what you own and
   does not track unplayed games. A game with no runs stays outside the model;
   there is no second base and no `game.add` without a run.
6. **Retroactive session start.** Designed during Phase 2, per this item's own
   note above. Two natural phrasings, both `--at` underneath, no new CLI
   surface needed: a session with both ends known ("forgot to log it, I played
   from 8 to 11 last night") opens and closes in two calls, read before write —
   if the open fails, the close is never sent, so a partial state is never
   left behind; a session still ongoing ("I've been playing since around 8") is
   one `start --at` call. See `agent/skills/gamereg/SKILL.md`'s *A session that
   was never recorded* for the implementation.
