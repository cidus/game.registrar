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

## Explicitly deferred

- Multi-user anything
- Web UI
- Automatic playtime detection from Steam or consoles
- Mobile app
- Sync — git is the sync

## Open questions

Not blocking Phase 0; decide before the phase noted.

5. **Timezone changes while travelling.** Events carry offsets, so the data is
   correct; `logical_day` grouping is what gets weird. *Ignore until it bites.*

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
6. **A backlog view.** No. The register holds what you played, per the non-goal
   in [00-architecture](00-architecture.md) — it does not know what you own and
   does not track unplayed games. A game with no runs stays outside the model;
   there is no second base and no `game.add` without a run.
7. **Retroactive session start.** Designed during Phase 2, per this item's own
   note above. Two natural phrasings, both `--at` underneath, no new CLI
   surface needed: a session with both ends known ("esqueci de marcar, joguei
   das 20h às 23h ontem") opens and closes in two calls, read before write —
   if the open fails, the close is never sent, so a partial state is never
   left behind; a session still ongoing ("tô jogando desde umas 20h") is one
   `start --at` call. See `agent/skills/gamereg/SKILL.md`'s *A session that
   was never recorded* for the implementation.
