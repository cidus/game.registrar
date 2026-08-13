# The Game Registrar

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

**Phase 0** — the register, no AI. The CLI records and renders; there is no
network, no provider, no SQLite, no agent and no site yet. See
[06-roadmap](docs/spec/06-roadmap.md).

```
git clone … && cd game.registrar && npm install && npm run build && npm link
```

Then, from the directory holding your register (or with `--vault <path>`):

```
gamereg start "hollow knight" --platform Switch
gamereg break start
gamereg break end
gamereg end --break 40m --note "Stuck on Watcher Knights."
gamereg finish "hollow knight" --rating 9 --difficulty hard --criteria true_ending
gamereg verdict "hollow knight" -m "Started as a curiosity and became..."
gamereg past "chrono trigger" --ended 2011-07 --rating 10 --hours 30
gamereg open · gamereg status · gamereg search "zelda"
gamereg build · gamereg build csv · gamereg doctor
```

A title not on record yet is offered as a new entry when you are at a terminal;
behind a pipe it exits 4 and `--no-metadata` opens it without asking.

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

`defaults` fills in what `start` was not told. Platform is taken from the game's
last run first, then from here; without either, the first run of a game asks for
`--platform` rather than guessing.

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

## License

Code under MIT.
