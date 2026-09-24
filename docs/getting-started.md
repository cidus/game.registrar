# Getting started

This tutorial starts from an empty directory and ends with a register holding
two recorded games, plus the Obsidian notes generated from them. You will
install the `gamereg` CLI from source, create a register, record a play
session, build the notes and then look around. After the install, nothing here
needs a network connection or an account.

You need:

- Node.js 22.18 or newer (`node --version`) and git.
- A terminal. Obsidian is optional; you can use it to read the notes at the end.

> [!NOTE]
> If you would rather run the CLI, the chat agent and vault maintenance from
> the published container image, with no clone, follow
> [Deploy with containers](guides/deploy-container.md) instead.

## 1. Install the CLI

The CLI is not published to npm, so install it from a clone:

```bash
git clone https://github.com/cidus/game.registrar.git
cd game.registrar
npm install
npm link
```

`npm install` also compiles the TypeScript through the package's `prepare`
script, so there is no separate build step. `npm link` puts `gamereg` on your
`PATH` by linking to this clone. To update later, run `git pull` and then
`npm install` in the clone. You do not need to link again.

Check that it works:

```bash
gamereg --version
```

It prints the version from `package.json`. A `-dev` suffix means you are
running an unreleased development version.

### If `npm link` fails with `EACCES`

npm is trying to write to a global prefix you do not own. Point it at a
directory in your home, add that directory to `PATH`, and link again. Also add
the `export` line to your shell profile.

```bash
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"
npm link
```

To leave `PATH` alone, skip `npm link` and run
`node /path/to/game.registrar/dist/src/cli/main.js` wherever this tutorial says
`gamereg`.

## 2. Create a register

A register is a directory. It holds the append-only event log, a config file
and the files that `gamereg build` generates from the log. Create one outside
the clone:

```bash
mkdir ~/games
cd ~/games
git init
gamereg init --timezone America/Sao_Paulo
```

Use your own IANA time zone name. At a terminal, `init` then asks for each
setting you did not pass as a flag. Press Enter to keep the default. When it
finishes you should see:

```text
Vault opened at /home/you/games. Targets: obsidian.
```

`init` writes three files:

| File | What it is |
|---|---|
| `gamereg.config.json` | Your settings, with every key at its default. You can edit it at any time. |
| `gamereg.secrets.json` | Empty credential fields, for metadata lookups later. |
| `.gitignore` | One line that keeps the secrets file out of git. |

The event log, `data/events.jsonl`, appears when you record your first event.

These `init` flags are worth knowing now. Each one sets a key in
`gamereg.config.json`, and the
[configuration reference](reference/configuration.md) describes them all.

| Flag | What it sets |
|---|---|
| `--timezone <zone>` | The time zone that days are counted in. |
| `--day-cutoff <HH:MM>` | When one day ends and the next begins, `05:00` by default. A session counts toward the day it **started** on, so a session started at 02:00 belongs to the previous day. |
| `--platforms <list>` | The platforms you own, comma separated. `gamereg` uses them to infer or offer a run's platform. They never restrict what you can record. |
| `--targets <list>` | What `gamereg build` generates. The default is `obsidian`. See [Build outputs](guides/build-outputs.md). |

Put the register under version control now. Git is how you back up a register
and move it between machines. There is no server and no account.

```bash
git add -A
git commit -m "Create the register"
```

## 3. Record a session

This step records an evening that has just happened: a session that started
three hours ago and included a twenty-minute break.

Open the session:

```bash
gamereg start "Hollow Knight" --platform "Nintendo Switch" --no-metadata --at -3h
```

```text
A new entry was opened for "Hollow Knight". No catalogue was consulted.
Filed: Hollow Knight (Nintendo Switch) — run opened, session opened at 18:14.
```

The register is empty, so nothing on record matches the title, and
`--no-metadata` tells `gamereg` to open a new entry for it. Without the flag,
a terminal shows a menu with the choice `None of these — open a new entry`,
and a script gets exit code 4. `start` opened two things. A **run** is one
playthrough of a game. A **session** is one sitting inside that run.

Record the break, then close the session:

```bash
gamereg break start --at -2h
gamereg break end --at -100m
gamereg end --break 20m --note "Stuck on Watcher Knights. Hard, but fair."
```

```text
Break opened at 19:14. Hollow Knight remains filed as in progress.
Break closed at 19:34. Duration: 20m.
Session closed at 21:14. Net duration: 2h20. Game total: 2h20.
Breaks deducted: 40m.
```

The duration is computed from the timestamps: three hours, minus the
twenty-minute break you logged, minus the extra twenty minutes given with
`--break`. Because only one session is open, `end` needs no title. Your clock
times will differ from the ones shown, but the durations will not.

Every recording command accepts `--at`, so you can record things after they
happen:

| Form | Example | Meaning |
|---|---|---|
| Relative | `--at -90m`, `--at -2h` | That long before now. |
| Clock time | `--at 20:14` | Today at 20:14, or yesterday if 20:14 has not come yet today. |
| Date and time | `--at "2026-08-12 20:14"` | That time, in the register's time zone. |
| ISO 8601 | `--at 2026-08-12T20:14:00-03:00` | Exactly that instant. |

Close the run now that you have finished the game:

```bash
gamereg finish "Hollow Knight" --rating 9 --difficulty hard --criteria true_ending
```

```text
Approved: Hollow Knight. 2h20 across 1 sessions.
Rating: 9.
```

`finish` closes the run, and any session still open on it. A rating is a whole
number from 0 to 11, or `none`. `--difficulty` and `--criteria` take fixed
tokens. An unknown token exits with code 2 and lists the valid ones.

File your review of the playthrough:

```bash
gamereg verdict "Hollow Knight" -m "Started as a curiosity and became the best game I played this year."
```

```text
Verdict filed for Hollow Knight. It appears in the note at the next build.
```

You can file a verdict whenever you are ready to write it. Filing again
replaces the earlier one.

Record a game you finished before you had a register:

```bash
gamereg past "Chrono Trigger" --ended 2011-07 --rating 10 --hours 30 --no-metadata
```

```text
Filed retroactively: Chrono Trigger, ended 2011-07.
Stated duration: 30.0 h — recorded as stated, not measured.
```

`past` records a run that is already over. The date can be a year (`2011`), a
month (`2011-07`) or a day (`2011-07-14`), and the run keeps that precision.
Hours given this way are marked as stated rather than measured. To bring in
many games at once, [import a spreadsheet](guides/import-spreadsheet.md).

Every command so far appended lines to `data/events.jsonl`, one JSON object per
event. Nothing ever rewrites that file, so do not edit it by hand. To correct
something, see [Fix mistakes](guides/fix-mistakes.md).

## 4. Generate the notes

```bash
gamereg build
```

```text
The register is in order: obsidian, 6 files written.
```

The default `obsidian` target wrote:

```text
obsidian/
  Game List.md                     one row per run
  Game Database.base               an Obsidian Bases view of the runs
  games/chrono-trigger.md          one note per game
  games/hollow-knight.md
  runs/2011-07-chrono-trigger.md   one note per run, named by its start date
  runs/YYYY-MM-DD-hollow-knight.md
.gamereg/manifest.json             the list of files the build owns
```

Run `gamereg build` again and it reports `0 files written`. The build
regenerates everything from the log and writes only the files whose content
changed.

`Game List.md` and the stats note are named in the vault's language: set
`locale` to `pt-BR` and they are `Lista de Jogos.md` and `Estatísticas.md`.
The folders, the game and run filenames, and everything the notes store in
frontmatter stay English in every language — see
[configuration](reference/configuration.md#locale).

In Obsidian, choose **Open folder as vault** and pick `~/games/obsidian`, not
`~/games`. That folder holds the notes. The log, the secrets file and the
build's bookkeeping stay one level up, outside Obsidian's index.

Where your own writing is safe:

- **Game notes (`games/*.md`) and `Game List.md`** keep anything you write
  outside the `<!-- gamereg:begin … -->` and `<!-- gamereg:end … -->` markers.
  The `## Notes` section at the end of each game note is there for you.
- **Run notes (`runs/*.md`)** are rewritten whole on every build, so anything
  you type into them is lost. Put session notes in `gamereg end --note` and
  your review in `gamereg verdict`. `gamereg doctor` warns you when a run note
  holds text that the next build would remove.
- **`Game Database.base`** is written once and then left alone, so your changes
  to its views are kept.

Commit the result:

```bash
git add -A
git commit -m "Record Hollow Knight and Chrono Trigger"
```

## 5. Look around

Summarize the register:

```bash
gamereg status
```

```text
2 games on record, 2 runs, 32.3 hours.
```

Show one game:

```bash
gamereg status "Hollow Knight"
```

```text
Hollow Knight — finished, 2.3 hours across 1 runs.
Run 1: YYYY-MM-DD to YYYY-MM-DD, 2h20, 1 sessions.
```

List the sessions still open. This is how you find one you forgot to close:

```bash
gamereg open
```

```text
No session is open.
```

Look a title up without recording anything:

```bash
gamereg search "hollow" --local-only
```

```text
1 entries match "hollow":
Hollow Knight — on record, finished
```

With `--local-only`, `search` looks only at your register. Without it, a title
with no local match is looked up at IGDB once you have configured credentials
([Metadata and covers](guides/metadata-and-covers.md)).

Validate the log and the generated files:

```bash
gamereg doctor
```

```text
The register is in order. 10 events, 2 games, 2 runs.
```

`doctor` reports problems and exits with code 1 when it finds any. It never
changes anything.

When a command's output goes to a pipe, or when you pass `--json`, it prints a
JSON envelope instead of these sentences. Scripts and the chat agent read that
envelope. See the [output contract](spec/02-cli.md#output-contract).

The clone's `example-vault/` directory is a complete register with fictional
data and every build target enabled. Copy it somewhere else before you run
commands against it.

## Next steps

| To | Read |
|---|---|
| Bring years of history in from a spreadsheet | [Import a spreadsheet](guides/import-spreadsheet.md) |
| Fetch developers, genres and cover art, and attach your own photos | [Metadata and covers](guides/metadata-and-covers.md) |
| Generate CSV, SQLite, a web page, stats or site input, and query the register | [Build outputs](guides/build-outputs.md) |
| Correct or withdraw something you recorded | [Fix mistakes](guides/fix-mistakes.md) |
| Record by chatting or by voice instead of typing | [Chat agent](guides/chat-agent.md) |
| Run the register, the agent and maintenance in containers | [Deploy with containers](guides/deploy-container.md) |
| Install the agent on a machine without containers | [Deploy on a host](guides/deploy-host.md) |
| Publish the register as a website | [Publish a site](guides/publish-site.md) |
| Find the cause of an error | [Troubleshooting](guides/troubleshooting.md) |

For reference:

| Topic | Page |
|---|---|
| Every command, flag and exit code | [02-cli](spec/02-cli.md) |
| Every configuration key | [Configuration](reference/configuration.md) |
| Environment variables | [Environment](reference/environment.md) |
| Games, runs, sessions and events | [01-model](spec/01-model.md) |
| How the log, the build and the agent fit together | [How it works](explanation/how-it-works.md) |
| Everything else | [Documentation map](README.md) |
