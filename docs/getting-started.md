# Getting started

Three parts, and only the first two are required: install the CLI, create a
register, and — if you want to talk to it instead of typing — set up the chat
agent.

The CLI is not published to a package registry yet, so it installs from a
clone. That is the only reason step 1 looks the way it does; everything after
it is what using the tool actually feels like.

## 1. Install the CLI

You need **Node 22.18 or newer** and git. Check with `node --version`.

```bash
git clone https://github.com/cidus/game.registrar.git
cd game.registrar
npm install
npm link
```

`npm install` compiles the TypeScript on its own (there is a `prepare` script),
so there is no separate build step. `npm link` puts `gamereg` on your PATH by
symlinking this clone — pulling new commits and running `npm install` again is
enough to update; you do not re-link.

Verify:

```bash
gamereg --version
```

If `npm link` fails on permissions, npm is trying to write to a global prefix
you do not own. Point it somewhere in your home directory instead:

```bash
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"   # add this to your shell profile
npm link
```

Prefer not to touch your PATH at all? Skip `npm link` and call
`node /path/to/game.registrar/dist/src/cli/main.js` directly. Every example
below works the same way.

## 2. Create your register

A register is a plain directory. It holds an append-only event log, a config
file, and whatever artifacts you asked the build to generate. Nothing is
hidden in a database somewhere else, and there is no import/export step —
the files *are* the register.

```bash
mkdir ~/games && cd ~/games
git init
gamereg init --timezone America/Sao_Paulo
```

`init` writes three files:

| File | What it is |
|---|---|
| `gamereg.config.json` | Your settings. Every key is optional. |
| `gamereg.secrets.json` | Empty credential slots, for metadata lookups later. |
| `.gitignore` | One line, ignoring the secrets file. |

**Put the register in git.** Git is the sync story — there is no server, no
account, no cloud. Commit after a session, or once a week; the log only ever
grows, so merges are about as easy as they get.

Useful flags at init time, all optional and all changeable later by editing
the config:

```bash
gamereg init \
  --timezone America/Sao_Paulo \
  --day-cutoff 05:00 \
  --platforms "PC,Nintendo Switch,PlayStation 5" \
  --targets obsidian,csv,sqlite
```

- `--timezone` — IANA name. Timestamps carry offsets regardless; this is what
  "today" means for grouping.
- `--day-cutoff` — when the logical day flips. `05:00` means a session that
  ends at 02:00 still counts as the previous day, which is usually what you
  meant.
- `--platforms` — the ones you own, comma separated. Used to offer sensible
  choices, never to restrict what you can record.
- `--targets` — which formats to generate. Defaults to `obsidian` alone. See
  [07-targets](spec/07-targets.md).

### Record something

```bash
gamereg start "hollow knight" --platform "Nintendo Switch"
gamereg break start
gamereg break end
gamereg end --break 20m --note "Stuck on Watcher Knights. Hard, but fair."
```

Durations are computed from the events, never estimated. Breaks are deducted.
If you forgot to start on time, `--at` takes `20:14`, `"2026-08-12 20:14"`,
full ISO, or `-90m` and `-2h` relative to now.

When you finish a game:

```bash
gamereg finish "hollow knight" --rating 9 --difficulty hard --criteria true_ending
gamereg verdict "hollow knight" -m "Started as a curiosity and became the best..."
```

Already played it years ago, before any of this existed?

```bash
gamereg past "chrono trigger" --ended 2011-07 --rating 10 --hours 30
```

### Generate the artifacts

```bash
gamereg build
```

This regenerates everything your `targets` declares, from the log, every time.
It is idempotent — running it twice produces byte-identical output — and it
never touches text you wrote by hand outside the generated markers.

For an `obsidian,csv,sqlite` register you get:

```
data/events.jsonl        the log — the only thing that matters
data/log.db              a SQLite cache, for queries
data/*.csv               spreadsheet-shaped exports
obsidian/games/*.md      one note per game
obsidian/runs/*.md       one note per playthrough
obsidian/Game List.md    the consolidated table
obsidian/Game Database.base
```

**Open `obsidian/` as your Obsidian vault, not the register root.** That folder
holds only what the build writes; your log, credentials and build bookkeeping
stay one level up, out of Obsidian's way.

Other commands worth knowing early:

```bash
gamereg status              # summary, or one game's state
gamereg open                # what is open right now
gamereg search "zelda"      # look something up, recording nothing
gamereg doctor              # validate the log, report anything irregular
```

## 3. Optional: metadata and cover art

`gamereg enrich` fills in developer, publisher, release year, genres,
platforms and cover art from [IGDB](https://www.igdb.com/).

**No command that records anything ever touches the network.** `start`, `end`,
`finish`, `past` and the rest are offline by construction, so a provider being
slow or down can never block you from logging a session, or slow it down. Only
`enrich` and `search` reach a provider at all — and `search` records nothing
by definition, so the guarantee holds either way.

Get a client id and secret from [IGDB's API docs](https://api-docs.igdb.com/),
then either put them in the secrets file:

```json
{
  "igdb": {
    "client_id": "…",
    "client_secret": "…"
  }
}
```

…or set `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` in your environment, which
takes precedence per field. The secrets file is gitignored by `init`; keep it
that way.

```bash
gamereg enrich "hollow knight" --covers   # one game
gamereg enrich --all --covers             # everything, never prompts
```

Skipping this entirely is fine. A register with no metadata still records
hours, notes, ratings and verdicts — which is the point of it.

## 4. Optional: the chat agent

The CLI works on its own, forever, with no AI involved. The agent is a layer
on top that turns "começando hollow knight" into `gamereg start "hollow
knight"` — and nothing more than that. It cannot write to your files, compute
a duration, or invent an identifier; every number it reports comes from the
database, because it has to ask the CLI like anyone else.

### What you need

**A gateway** — something that receives your messages, runs a model, and can
shell out. [OpenClaw](https://openclaw.ai) is the reference deployment
(self-hosted, multi-channel, handles voice notes and images), but nothing in
the design depends on it. Any gateway that can execute a command works.

**A model.** This project is deliberately provider-agnostic — the contract is
the CLI's JSON output, not any vendor's API. What the model actually needs:

- **Tool/function calling**, to run commands at all.
- **Decent instruction-following.** It writes SQL against a documented schema
  and constructs CLI invocations; a model that improvises will produce
  invocations that fail loudly rather than data that is quietly wrong, but
  it will annoy you.
- **Image input**, only if you want to send screenshots and photos.

Anything meeting that bar is fine — hosted (Anthropic, OpenAI, Google,
DeepSeek, OpenRouter, and others) or local (Ollama, LM Studio) if your
hardware can run a model with reliable tool calling. Pick during your
gateway's setup; for OpenClaw that is `openclaw onboard`, which asks.

**A machine that stays on**, if you want to message it while away from your
desk. A mini PC, an old laptop, a VPS — the agent is not demanding.

### Setting it up

The gamereg side of the deployment — the skill that teaches the agent this
CLI, the Registrar's persona, the channel configuration, and the security
boundaries — lives in **[`agent/`](../agent/)**, and
**[`agent/README.md`](../agent/README.md)** is the step-by-step guide.

Read it before wiring anything up. It is not a generic tutorial: every config
key in it was found wrong by upstream documentation at least once and
corrected against a real install, and it says which — including a permissions
trap that costs an afternoon to diagnose from scratch.

The short version of what you will do there: install the CLI on the
always-on host, create a bot for your chat channel, restrict who may talk to
it, tell the gateway where your register lives, copy the skill in, and
constrain what the agent is allowed to execute.

### Voice

Voice notes are transcribed by the gateway *before* the CLI sees anything —
`gamereg` never touches audio. Transcription can be local (Whisper on the
host) or hosted; the tradeoff is privacy and cost against setup effort and
accuracy on your language.

Transcribed game titles are unreliable no matter which you pick. That is what
`gamereg alias` is for: correct a mangled title once, and the register
recognizes it from then on.

## Where to go next

| If you want to… | Read |
|---|---|
| Understand the data model | [01-model](spec/01-model.md) |
| See every command and flag | [02-cli](spec/02-cli.md) |
| Know why it is built this way | [00-architecture](spec/00-architecture.md) |
| Change what the build generates | [07-targets](spec/07-targets.md) |
| Deploy the chat agent | [`agent/README.md`](../agent/README.md) |

`example-vault/` in the repository is a complete working register with
fictional data — the fixtures the test suite builds against. Poke at it if you
want to see what a populated register looks like before committing to your
own.
