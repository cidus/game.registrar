# The Game Registrar

[![Version](https://img.shields.io/github/package-json/v/cidus/game.registrar)](https://github.com/cidus/game.registrar/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen)](package.json)
[![Changelog](https://img.shields.io/badge/changelog-Keep%20a%20Changelog-orange)](CHANGELOG.md)

> *The Registrar notes that the Hollow Knight session, filed at 20:14, remains
> open. Kindly state the time of closure.*

A gaming journal that lives in text files. You talk to the Registrar — by chat,
by voice, or from the terminal — and it files everything into Markdown, versioned
in git.

This is not another backlog manager. It is a **register**: sessions with hours,
a note per session, and a consolidated verdict when the game ends.

```
$ gamereg start "hollow knight"
Filed: Hollow Knight (Switch) — session opened at 20:14.

$ gamereg end --break 40m --note "Stuck on Watcher Knights. Hard, but fair."
Session closed at 23:52. Net duration: 2h58. Game total: 21h10.
```

## Principles

1. **Your data is text.** Markdown and JSONL in a git repo. No proprietary
   database, no export button, no escape hatch — because there is nothing to
   escape from.
2. **The AI interprets; the code executes.** The agent translates natural
   language into CLI calls. Arithmetic, state and file writes are deterministic,
   testable code.
3. **It works without AI.** The CLI is usable on its own, from a terminal, with
   no API key. The agent is an optional layer.
4. **Nothing you wrote by hand is ever rewritten.** The build only touches what
   sits between markers.
5. **One log, several shapes.** The same events become Obsidian notes, a
   sortable base, a spreadsheet, a database — because a register you cannot
   query from the angle you want is a diary with extra steps.

## Status

**Phases 0–2 done and tagged (`v0.2.0`); phase 3 built, not yet tagged.** The
CLI records, enriches titles and cover art from IGDB, ingests your own photos,
and regenerates Obsidian notes and a sortable Base, CSV, JSON, an HTML table
and a SQLite cache — all from one event log. A chat agent for
[OpenClaw](https://openclaw.ai) lives in [`agent/`](agent/) and is
live-tested on a real Telegram deployment, voice included: recording a game
by text or by speaking, answering the platform question, correcting an
already-recorded run, ad hoc questions answered by SQL against the register,
opening a live session with `start`, exit-code-3 disambiguation resolved by
an actual inline-button tap, a session closed by a voice note, and a full
`finish` + `verdict` pass — the roadmap's own exit criterion for phase 2, a
game logged start to finish without opening a terminal once. **Phase 3's five
steps are all built, and the Registrar now speaks first:** `gamereg due`
decides in code which open session is owed a question — three triggers, a delivery slot, quiet hours, an escalating backoff
ladder and a hard ceiling — and an hourly poll on the gateway host wakes the
agent only when there is something to ask, so a quiet day costs nothing and
says nothing. The build also emits a `stats` note with a calendar heatmap and a
year in review, the agent can react with a sticker where an installation maps
one, and `gamereg build quartz` writes the register a second time as
[Quartz](https://quartz.jzhao.xyz) input — notes, a front page and a seeded
config — which gamereg emits and never builds: turning it into a site is
yours to run, by hand or from CI. See
[06-roadmap](docs/spec/06-roadmap.md), [`CLAUDE.md`](CLAUDE.md)'s *Current
state* for the detailed status, and [`CHANGELOG.md`](CHANGELOG.md) — or the
tagged [releases](https://github.com/cidus/game.registrar/releases) for the
fuller version of the same story — for what shipped in each phase.

```
git clone … && cd game.registrar && npm install && npm link
```

New here? **[docs/getting-started.md](docs/getting-started.md)** walks through
installing, creating a register, and setting up the chat agent. The rest of
this page is the overview.

Then, from the directory holding your register (or with `--vault <path>`):

```
gamereg init
gamereg start "hollow knight" --platform Switch
gamereg break start
gamereg break end
gamereg end --break 40m --note "Stuck on Watcher Knights." --photo boss.jpg
gamereg finish "hollow knight" --rating 9 --difficulty hard --criteria true_ending
gamereg verdict "hollow knight" -m "Started as a curiosity and became..."
gamereg past "chrono trigger" --ended 2011-07 --rating 10 --hours 30
gamereg enrich --all --covers
gamereg open · gamereg status · gamereg search "zelda"
gamereg query "select title, hours from games order by hours desc limit 5"
gamereg build · gamereg build csv · gamereg doctor
```

A title not on record yet is offered as a new entry when you are at a terminal;
behind a pipe it exits 4 and `--no-metadata` opens it without asking.
`gamereg enrich` needs IGDB credentials — `gamereg init` seeds an empty
`gamereg.secrets.json` for them; nothing else in the CLI ever touches the
network.

Open **`obsidian/`** inside your register as the Obsidian vault, not the
register's own root — that folder is everything the `obsidian` target
writes (notes, the consolidated table, the Base), kept separate from the
event log, credentials and build bookkeeping sitting one level up.

`example-vault/` is a working register with fictional data — the golden files the
test suite builds against.

### Configuration

`gamereg.config.json` at the vault root, every key optional:

```json
{
  "locale": "pt-BR",
  "timezone": "America/Sao_Paulo",
  "day_cutoff": "05:00",
  "defaults": { "platform": "Switch", "form": "digital", "mode": "solo" }
}
```

`defaults` fills in what `start` was not told. Platform is taken from the
game's last run first, then from here, then from a single-platform match
against the catalog once the game is enriched; without any of those, `start`
opens the session with no platform recorded rather than asking — `end`,
`finish` and `drop` settle it later, once there is a catalog to narrow from.

`build.targets` declares which formats the vault emits, defaulting to
`["obsidian"]`:

```json
{ "build": { "targets": ["obsidian", "csv"] } }
```

`gamereg build` emits all of them; `gamereg build csv` narrows one build without
changing what the vault contains. See
[07-targets](docs/spec/07-targets.md).

## Specs

| Document | Contents |
|---|---|
| [00-architecture](docs/spec/00-architecture.md) | Decisions, non-goals, stack, repository layout |
| [01-model](docs/spec/01-model.md) | Entities, JSONL events, enums, derived state |
| [02-cli](docs/spec/02-cli.md) | Subcommands, flags, exit codes, output contract |
| [03-resolution](docs/spec/03-resolution.md) | Name resolution and disambiguation |
| [04-derived](docs/spec/04-derived.md) | Game notes, run notes, table, bases, SQLite |
| [05-agent](docs/spec/05-agent.md) | Chat layer, voice, check-ins, persona |
| [06-roadmap](docs/spec/06-roadmap.md) | Delivery phases |
| [07-targets](docs/spec/07-targets.md) | Build targets: contract, config, ownership |

## Localization

The schema and the codebase are English. The interface is localized: command
verbs, prompts and generated labels come from `i18n/<locale>.json`. `en` and
`pt-BR` ship in the box — `gamereg start` and `gamereg iniciar` are the same
command.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for
setup and conventions, [SECURITY.md](SECURITY.md) to report a vulnerability
privately, and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Code under MIT.
