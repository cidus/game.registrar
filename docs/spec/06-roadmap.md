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
- Quartz site. Shipped as the `quartz` target plus a documented recipe
  (`scripts/vendor-quartz.sh`); no GitHub Action was written, and building the
  site is still the user's own step
- Calendar heatmap, year-in-review generation

The two halves of the name are one phase because they fail the same way alone: a
register that only speaks when spoken to loses closing times, and one nobody but
its author can read is a diary with extra steps.

`quartz` emits Quartz's input and stops there; running Quartz is the user's
business — see [07-targets](07-targets.md). Nothing in this phase touches a
provider or any external service: the tempting ones are either deferred already
(Steam and console playtime) or have no official API at all.

**Exit criterion:** a session left open overnight is chased the next morning,
answered in chat, and the corrected record appears on a published page that
someone who does not own the vault can read. One sentence, and it exercises the
check-in machinery (the ladder and the delivery slot), the site, and the fact
that a correction propagates.

That page may be published by hand: `scripts/vendor-quartz.sh` is a recipe that
has been run against a real Quartz checkout and a real deploy, and following it
closes this criterion. What the phase below adds is not the page, it is that
somebody who does not have the recipe can get one — so this phase does not
depend on the next one existing, only on a person willing to follow steps.

## Phase 4 — Someone else's machine

**Goal:** the tool installs, configures itself and runs on a machine its author
has never touched.

**Delivered so far:**

- A container image carrying the CLI, the gateway, the skill and the persona at
  versions known to work together, built and verified by CI and published to
  `ghcr.io/cidus/gamereg` as `:edge` and `:sha-<commit>`. `compose.yml` runs
  from it, so an installation needs no clone.
- A home for the two things a host supplies by hand: the check-in cron job,
  registered by a one-shot `provision` service once the gateway is healthy, and
  the maintenance timer, which is a loop service in the stack.
- The git identity and push credential the vault's own automation needs.

**Still open:**

- Published package; the install path in `docs/getting-started.md` reduced to one
  command
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
web UI is what they will ask for. `html` and `quartz` are the answer; a server with
accounts is still not.

**Exit criterion:** someone who has never seen this repository installs it and
records a session — without cloning anything, and without being told anything
that is not in the generated README.

## After 1.0

### Board games

- `person` and `play.record` events
- BoardGameGeek provider (XML API v2), or the existing BGG MCP for the agent
- Play-centric notes: players, scores, winner, duration
- Per-person statistics

The model already accommodates this (D6); a schema migration here means
something went wrong earlier. That is exactly why it moved out of the numbered
sequence rather than merely swapping places with the phase above it. Work that
is additive by design is the safe thing to ship *after* contracts freeze, and
holding `1.0.0` — the version a stranger can install — hostage to a second
category of game would misprice the release.

## Explicitly deferred

- Multi-user anything
- Web UI
- Automatic playtime detection from Steam or consoles
- Mobile app
- Sync — git is the sync
- **Franchise and series grouping.** Deferred past phase 1 so real usage could
  show whether it is wanted before the model or the provider mapping committed
  to it. Several phases later nothing has asked for it, so it stays here.

## Decided

Questions this roadmap used to carry, now settled. Each has a decision record
with the reasoning and the costs accepted:

| Question | Decision |
|---|---|
| Cover and screenshot licensing for a public site | One `images.publish` switch, off by default — [0055](../decisions/0055-one-publish-switch-rendered.md) |
| Multi-platform runs | Platform stays on the run — [0006](../decisions/0006-platform-lives-on-the-run.md) |
| Timezone changes while travelling | Nothing to build: the logical day is derived on every fold — [0025](../decisions/0025-no-timezone-detection.md) |
| A backlog view | No. The register holds what was played — [0007](../decisions/0007-no-backlog.md) |
| Retroactive session start | `--at` on the commands that already exist — [0009](../decisions/0009-unrecorded-session-uses-at.md) |

Franchise and series grouping is in *Explicitly deferred* above.
