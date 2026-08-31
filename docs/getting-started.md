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

### Coming from a spreadsheet

`gamereg past` is fine for a handful of games typed by hand. If you're
arriving with years of history already tracked in a spreadsheet,
`gamereg import` files one `past`-shaped run per row instead.

Say `games.csv` looks like this:

```csv
Title,Finished,Started,Hours,Rating,Review
Chrono Trigger,2011-07,,30,10,Still the best time-travel plot in the medium.
Hollow Knight,2026-08-12,2026-05-03,42.3,9,
Celeste,2026,,,,
```

A mapping file says which of your columns is which gamereg field — see the
[full field table](spec/02-cli.md#gamereg-import-filecsv---mapping-filejson)
for everything beyond what's used here:

```json
{
  "title": "Title",
  "ended": "Finished",
  "started": "Started",
  "hours": "Hours",
  "rating": "Rating",
  "verdict": "Review"
}
```

`hours` needs a plain decimal point (`42.3`), not a comma — reformat the
column first if your spreadsheet exported one.

Check what it would do before doing it:

```bash
gamereg import games.csv --mapping mapping.json --dry-run
```

`--dry-run` resolves every row and reports the result without writing
anything. Read it — specifically, read which titles it matched to existing
games and which it's about to create. **This is the step not to skip:** an
unmatched title becomes a brand-new local game the instant a real import runs,
and once a title exists locally, `gamereg search` stops asking a provider
about it at all. A batch of badly resolved rows becomes that many phantom
games that go on answering silently forever; undoing one is `gamereg revoke`,
event by event. A `--dry-run` pass costs nothing and catches this before it
happens.

Happy with what `--dry-run` reported:

```bash
gamereg import games.csv --mapping mapping.json
```

```json
{ "ok": true, "result": { "imported": [
  { "row": 2, "game_id": "...", "run_id": "...", "title": "Chrono Trigger" },
  { "row": 3, "game_id": "...", "run_id": "...", "title": "Hollow Knight" },
  { "row": 4, "game_id": "...", "run_id": "...", "title": "Celeste" } ],
  "failed": [] } }
```

A row that fails — an out-of-range rating, an unparseable `hours` cell —
doesn't stop the rest; it's reported by CSV line number in `result.failed[]`
and everything else still gets written. Run `gamereg enrich --all` afterward
to fetch metadata and cover art for whatever got created — import itself
never touches the network (non-negotiable 5).

**One more thing worth knowing going in:** an imported run has no sessions —
there was nothing to time. `gamereg stats`'s heatmap and year-in-review read
sessions to know which days you played, so years you just imported will show
up empty there even though you played every day of them. That's not a bug;
the hours are recorded as *stated*, not *measured*, and the register doesn't
invent days nobody logged at the time.

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

Add `stats` to `targets` and the build also writes `obsidian/Stats.md` and one
`obsidian/reviews/<year>.md` per year you played, each with a calendar heatmap.
Those two notes are spliced like a game note, so anything you write around the
generated tables — the paragraph that says what the year was actually like —
survives every later build.

Add `quartz` and the build writes the register a second time, as input for
[Quartz](https://quartz.jzhao.xyz): `quartz/content/` — one page per game, one
per playthrough, the consolidated table as the front page, the same Stats
page and year-in-review notes `stats` writes into the vault, and the same
`Game Database.base` the vault gets, for the `@quartz-community/bases-page`
plugin the seeded config already enables — plus a seeded
`quartz/quartz.config.yaml` that is yours the moment you touch it. **gamereg
never runs Quartz.** It emits the input and stops; building the site is yours
to run, by hand or from CI, and nothing about the rest of the register depends
on Quartz being installed. Your own photos and cover art reach the site only if
you set `images.publish` to `true` — off by default, and the pages say plainly
where a picture was withheld.

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
on top that turns "starting hollow knight" into `gamereg start "hollow
knight"` — in whatever language you happen to say it. It cannot write to your
files, compute a duration, or invent an identifier; every number it reports
comes from the database, because it has to ask the CLI like anyone else.

It can also speak first, if you set up the optional hourly poll described in
`agent/README.md`: a session left open too long, or still open the morning
after, gets one question. The CLI decides when that happens, not the model, and
a poll with nothing to ask says nothing at all.

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
it, tell the gateway where your register lives, copy the skill and the
workspace files in, and constrain what the agent is allowed to execute — both
which commands it may run and which of the gateway's own tools it can see at
all. The second one matters more than it sounds: a tool the agent can see is a
tool it will eventually reach for, whatever the prompt says.

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
