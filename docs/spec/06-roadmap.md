# 06 — Roadmap

Each phase ends with something usable. No phase depends on the next one existing.

## Phase 0 — The register, no AI

**Goal:** prove the data model by living in it for two weeks, from a terminal.

- Event log: append, fold, validate
- `start`, `end`, `break`, `finish`, `drop`, `past`, `open`, `status`, `verdict`
- Local-only resolution (steps 1–5 and 7 of the resolution order)
- `build` as a target registry, with ownership tracking
- `obsidian` target: game notes, run notes, `Games.md`, seeded `Games.base`
- `csv` target: runs, sessions, games
- Image ingestion: `--photo`, hashing, normalization, EXIF strip, `cover`
- Golden-file tests, idempotency test, `doctor`

**Deliberately absent:** network, providers, SQLite, agent, site.

`csv` and the Bases seed are here rather than in phase 1 for one reason: the exit
criterion is two weeks of *looking* at the data, and a static Markdown table is
not something you can look at from an angle. They cost little and they are what
makes the trial produce an opinion instead of a shrug.

**Exit criterion:** two weeks of real use with no manual file edits and no
arithmetic that had to be corrected. If the model is wrong, this is when it is
cheap to find out — and an agent built on a wrong model just produces wrong data
faster.

## Phase 1 — Metadata and querying

- `providers/igdb.ts`, then `rawg.ts` as fallback
- `enrich`, cover download via `sharp`
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

1. **Cover and screenshot licensing for the public site.** Box art from a
   provider is not ours to republish; screenshots of a game are murkier; photos
   you took of your own shelf are plainly yours. `images.publish` and
   `images.publish_covers` are separate switches precisely because the answers
   differ. *Decide before Phase 3.*
2. **Multi-platform runs.** Started on Switch, finished on PC. Currently
   `platform` sits on the run. Might need to move to the session. *Watch during
   Phase 0; the log will show whether it happens.*
3. **Franchise / series grouping.** Wanted for statistics, absent from the model.
   Could be a derived tag from provider data rather than a stored field.
   *Decide during Phase 1.*
6. **A backlog view.** A game with no runs has no row in a run-level base, which
   is correct and also means unplayed games are invisible to every query view.
   A second base over `games/` solves it; whether the register should hold games
   you have not played at all is the actual question. *Decide during Phase 1.*
4. **Retroactive session start.** Forgetting to open a session will be far more
   common than forgetting to close one. `--at` covers it, but the chat flow needs
   a natural phrasing. *Design during Phase 2.*
5. **Timezone changes while travelling.** Events carry offsets, so the data is
   correct; `logical_day` grouping is what gets weird. *Ignore until it bites.*
