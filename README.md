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

## Status

Specification stage. Nothing implemented yet.

## Specs

| Document | Contents |
|---|---|
| [00-architecture](docs/spec/00-architecture.md) | Decisions, non-goals, stack, repository layout |
| [01-model](docs/spec/01-model.md) | Entities, JSONL events, enums, derived state |
| [02-cli](docs/spec/02-cli.md) | Subcommands, flags, exit codes, output contract |
| [03-resolution](docs/spec/03-resolution.md) | Name resolution and disambiguation |
| [04-derived](docs/spec/04-derived.md) | Markdown notes, table, SQLite, site |
| [05-agent](docs/spec/05-agent.md) | Chat layer, voice, check-ins, persona |
| [06-roadmap](docs/spec/06-roadmap.md) | Delivery phases |

## Localization

The schema and the codebase are English. The interface is localized: command
verbs, prompts and generated labels come from `i18n/<locale>.json`. `en` and
`pt-BR` ship in the box — `gamereg start` and `gamereg iniciar` are the same
command.

## License

Code under MIT.
