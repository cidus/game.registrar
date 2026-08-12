# 00 — Architecture

## Problem

Keep a durable record, over years, of the games I play: when I started, how many
hours I spent, what I thought after each session, and a final verdict when I
finish. Input by conversation (including voice), data always exportable and
offline, optional publication as a website.

## Decisions

### D1 — The source of truth is an append-only event log

`data/events.jsonl`. One event per line, never rewritten. Everything else —
Markdown notes, the consolidated table, SQLite, the site — is **derived** and
fully regenerable from scratch.

*Why:* an LLM editing a structured file in place corrupts data silently. Append
is the only operation an agent can perform without risking history. Corrections
are new events, not edits. Bonus: git diffs stay readable, and board games slot
into the same model with no migration.

*Accepted cost:* state must be rebuilt by folding the log on every read. At a few
thousand events this is instant. Do not optimize before it hurts.

### D2 — The CLI is the only writer

No other component — not the agent, not the build — writes to the log. The agent
translates natural language into `gamereg` invocations.

*Why:* hour arithmetic, open-session detection, deduplication and enum validation
must be deterministic and testable. An LLM summing hours gets it wrong, and gets
it wrong in a way you discover months later.

### D3 — The CLI never blocks on input

When something is ambiguous it **returns** the candidates (exit code + JSON)
rather than opening a menu. The interactive menu is a **presenter** built on top
of that return value, enabled by default when a human is at a terminal and
disabled automatically otherwise.

*Why:* the caller may be an agent with no TTY, and a blocked prompt in that
context hangs forever. Detection defaults correctly for both audiences, so
neither has to pass a flag. See [02-cli](02-cli.md) and
[03-resolution](03-resolution.md).

### D4 — Single runtime: Node + TypeScript

*Why:* `unified`/`remark` gives a real Markdown AST, which is what allows
regenerating blocks while preserving hand-written prose byte for byte. Quartz
builds the site straight from an Obsidian vault with no converter. OpenClaw is
Node, should a native plugin ever be wanted.

### D5 — Metadata providers are pluggable and isolated

`src/providers/<name>.ts` behind a common interface. The core does no network I/O.

*Why:* testability (mocking is trivial), and the log must work for games that
exist in no database at all — ROM hacks, jam games, a friend's prototype.

### D6 — Hierarchy: game → run → session

A game has N runs (playthroughs); a run has N sessions.

*Why:* it handles replays ("finished it again in 2027, liked it more") with no
migration, and it is the same shape a board game has (one game, N plays over
years). Today nearly every game will have a single run; the field costs nothing
now and is expensive to retrofit.

### D7 — English schema, localized interface

The schema uses `difficulty`, `completion_criteria`, `rating`. Display labels and
command aliases live in `i18n/<locale>.json`. `gamereg start` and
`gamereg iniciar` resolve to the same command.

*Why:* the project is public. A Portuguese schema locks adoption to Brazil, and
renaming keys after 200 files is expensive.

## Non-goals

- **Not a library manager.** It does not import your Steam account, does not know
  what you own, does not suggest what to play. It records what you played.
- **No server, no accounts.** Runs on your machine, writes to your files.
- **Not social.** No profiles, no following, no feed.
- **No automatic tracking.** You say you started; it does not detect it.
- **Not a replacement for Obsidian.** It emits files Obsidian reads well, but
  does not depend on it. Any text editor works.

## Two repositories

This repo holds **the tool**. Your data lives in a separate repo of your own,
most likely private.

```
game.registrar/              # this repo — MIT, public
  src/
  docs/spec/
  example-vault/             # fictional data: demo, tests and golden files
  templates/
  i18n/

my-register/                 # user repo — private
  gamereg.config.json
  data/events.jsonl          # source of truth
  data/log.db                # derived (gitignored)
  games/*.md                 # derived blocks + hand-written prose
  assets/<sha>/            # content-addressed images
  Games.md                   # derived
  site/                      # derived (gitignored)
```

*Why separate:* your notes are personal. In one repo you either publish your
diary alongside the code, or you never publish the code.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node 22+, TypeScript, ESM |
| CLI | `commander` + `@inquirer/prompts` (only when interactive) |
| Markdown | `unified` + `remark-parse` + `remark-stringify` + `remark-frontmatter` |
| YAML | `yaml` (frontmatter is always regenerated; no round-trip needed) |
| SQLite | `node:sqlite` (built in, Node 22+) |
| HTTP | native `fetch` |
| Images | `sharp` |
| IDs | `ulid` |
| Dates | `luxon` — timezone handling and date arithmetic must be trustworthy |
| Tests | `node:test` + golden files |
| Site | Quartz (phase 3) |

## Invariants

Breaking any of these is a serious bug, not a preference.

1. `events.jsonl` only grows. No line is ever altered or removed.
2. `gamereg build` is **idempotent**: running it twice produces identical bytes.
3. Nothing outside `<!-- gamereg:... -->` markers is modified in a note.
4. Deleting every derived artifact and running `build` restores everything with
   no loss.
5. No write command performs network I/O. Enrichment is a separate step.
6. Every state mutation corresponds to at least one event in the log.
7. Rating arithmetic, hour arithmetic and session state are computed in code,
   never by a language model.

## Threat model (brief)

The agent has shell access and a messaging channel. Assume the channel is
reachable by others.

- The CLI validates every argument against the schema. An agent cannot write an
  invalid enum, a negative duration, or a rating outside range.
- No command deletes data. `amend` and `revoke` append events; the original stays
  on record.
- Anything destructive at the filesystem level (removing derived artifacts) is
  behind an explicit flag and never invoked by the agent.
