# Troubleshooting

Symptoms, their causes and what to do. Look for what you actually see; the
explanations live behind the links.

## Before you dig in

```bash
gamereg doctor                       # validates the log and reports anything irregular
gamereg status --json                # what the register thinks is true
docker compose logs gateway | grep entrypoint   # the container's boot sequence
docker compose exec gateway openclaw cron runs  # what the check-in poll did
```

Exit codes are part of the CLI's contract, not failures by themselves: see
[exit codes](../spec/02-cli.md#exit-codes). Code 3 (ambiguous) and code 4 (not
found) are answers to a question.

Session transcripts, which settle what the agent was actually told, are under
`~/.openclaw/agents/<agent>/sessions/` on a host and
`/config/agents/<agent>/sessions/` in the container.

## Command line and register

### `npm link` fails with `EACCES`

**Cause.** npm is writing to a global prefix you do not own.

**Fix.** Use a prefix in your home directory:

```bash
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"   # add to your shell profile
npm link
```

Or skip `npm link` and call `node /path/to/game.registrar/dist/src/cli/main.js`.

### The CLI behaves like an older version of the code

**Cause.** `npm link` links `dist/`, so `git pull` changes nothing until the
TypeScript is compiled.

**Fix.** `npm run build`, then confirm with something only the new code has.

### Two accounts disagree about the same register

**Cause.** A per-user npm prefix gives each account its own copy of `gamereg`.

**Fix.** Install once for everyone (`sudo npm install -g`) so every user
resolves the same binary.

### `EACCES: permission denied, mkdir '<vault>/data'`, while the same command works over SSH

**Cause.** The vault's group was added after the process started.
Supplementary groups resolve at login, and `systemctl --user restart` restarts
inside the existing session.

**Fix.**

```bash
id                                                   # your groups
PID=$(systemctl --user show -p MainPID --value openclaw-gateway.service)
grep ^Groups /proc/$PID/status                       # the gateway's
sudo systemctl restart user@<your-uid>.service       # interrupts all user units
```

### `gamereg build` exits 5

**Cause.** Another build is writing. The build takes a lockfile and refuses
rather than queueing.

**Fix.** Wait and run it again. A build lost this way is not lost work: the
next one regenerates everything from the log.

### `gamereg amend` exits 2

**Cause.** Several, and the message says which: `--reason` is required, at
least one `--set` is required, the field does not belong to that event's type,
or the target is itself a correction.

**Fix.** Take the event id from `gamereg status --json`: a run has two
correctable events, `run_open_event_id` (platform, started_on, hours) and
`run_close_event_id` (rating, difficulty, note, outcome, completion criteria).
See [Fix mistakes](fix-mistakes.md) and
[ADR 0094](../decisions/0094-amend-refuses-foreign-keys.md).

### `gamereg import` exits 1 but rows were imported

**Cause.** A row failed (an out-of-range rating, an unparseable `hours` cell).
The other rows were written.

**Fix.** Read `result.failed[]`, which reports the CSV line number, fix those
rows and import them alone. See
[Import a spreadsheet](import-spreadsheet.md).

### A title resolves to a game that was never played

**Cause.** An import or a mistyped title created a local entry. Once a title
exists locally, `search` stops asking a provider about it.

**Fix.** Revoke the events that created it, newest first, and check with
`gamereg doctor`. See [Fix mistakes](fix-mistakes.md).

## Configuration

### Every write exits 1 with `Could not read "Invalid DateTime" as a time`, but `status` works

**Cause.** `timezone` in `gamereg.config.json` is not a valid IANA zone name.
It is not validated when it is written.

**Fix.** Correct the zone (`America/Sao_Paulo`, not `GMT-3`).

### `--photo` exits 2 with `could not be read as an image`, for an image that opens fine

**Cause.** `images.max_edge` or `images.quality` is out of range, and the
encoder fails rather than the file.

**Fix.** `max_edge` a positive number of pixels, `quality` between 1 and 100.
See [Configuration](../reference/configuration.md).

### `<file> is not valid JSON` for a file that is valid JSON

**Cause.** A malformed entry inside `platforms`, or a non-string in
`build.targets`.

**Fix.** `platforms` takes strings or `{ "name": …, "aliases": [...] }`;
`build.targets` takes strings.

### An unknown key exits 2

**Cause.** Configuration keys are strict, and the valid names come from the
defaults themselves
([ADR 0015](../decisions/0015-unknown-config-keys-exit-2.md)).

**Fix.** The error names the key and what is valid at that level. Note that
`gamereg init --yes` cannot repair a config that fails to load: fix the file
first.

### The container dies with `gamereg init failed`

**Cause.** A seeding value is malformed — most often `GAMEREG_DAY_CUTOFF=5:00`,
which needs two digits (`05:00`).

**Fix.** Correct `.env` and start again. The vault is only seeded when it has
no `gamereg.config.json`, so a half-written vault has to be cleared by hand.

## Chat agent

### The agent answers like a generic assistant, with no error anywhere

**Cause.** The persona and the skill were not found, so the model answers with
no instructions. Nothing logs it.

**Fix.** Check that the workspace holds them
(`docker compose exec gateway ls /config/workspace`), and on a host that
`~/.openclaw/workspace/` holds real copies rather than a symlink — OpenClaw
refuses a skill path that escapes its root, logging
`Skipping escaped skill path outside its configured root: reason=symlink-escape`.

### `No API key found for provider "anthropic"`

**Cause.** The credential lives in the gateway's own auth store, not in the
environment. Setting `CLAUDE_CODE_OAUTH_TOKEN` looks like configuration and
authenticates nothing
([ADR 0081](../decisions/0081-credentials-in-the-auth-store.md)). The
entrypoint installs it at boot, but only once.

**Fix.** Put a fresh token in `.env`, delete the marker and restart:

```bash
docker compose exec gateway rm /config/.gamereg-auth-seeded
docker compose restart gateway
```

### The bot answers only sometimes

**Cause.** Two consumers of one bot token. Telegram long-polling does not
share, so two gateways fight over every update.

**Fix.** Find the other one — often an old host install whose unit is still
enabled (`systemctl --user disable --now openclaw-gateway.service`) — or give
one of them a second bot from BotFather.

### A prompt fix does not take, and the agent repeats what you corrected

**Cause.** Prompt files are read into a session when it starts. Restarting the
gateway does not change a session already under way.

**Fix.** Send `/reset` in the chat. To confirm the new text reached the model,
grep the session transcript for a phrase unique to it.

### The agent says it recorded something and the register does not have it

**Cause.** An `amend` that named a field the target event does not carry. It
used to be accepted and silently do nothing; it is refused now.

**Fix.** Check `gamereg status --json` for what was actually filed, and correct
the right event. See [Fix mistakes](fix-mistakes.md).

### A `message` call reports success and the message is wrong

**Cause.** An argument the tool's schema does not define is accepted and
dropped without a word.

**Fix.** Settle what the tool accepts from the agent's own trajectory file
(`sessions/*.trajectory.jsonl`), which records the definitions it was handed.

### A candidate menu arrives out of order

**Cause.** Messages sent in one turn race, and the gateway's per-chat ordering
queue only runs for group chats.

**Fix.** Nothing to configure; this is why a menu is one message per candidate
with the closing line last.

### A stranger messages the bot and gets an answer

**Cause.** Pairing mode answers anyone with their own id and a one-time code —
by design, since that is how you learn your id. It files a request; it does not
grant access.

**Fix.** If you want silence instead, set `TELEGRAM_ALLOW_FROM` to your numeric
id and restart. The pairing store and the allowlist never merge
([ADR 0080](../decisions/0080-telegram-pairing-reveals-the-sender-id.md)).

## Check-ins

### No check-in ever arrives

**Cause.** The job is not registered, the poll finds nothing due, or the answer
is being withheld by quiet hours or backoff.

**Fix.** Check the job and ask the CLI directly:

```bash
docker compose exec gateway openclaw cron list --all
gamereg due --json                      # what is due now
gamereg due --json --at "2026-08-23 09:00"   # what would be due then
```

### The check-in reaches a chat that is not yours

**Cause.** A cron wake carries no delivery routing, and a bare channel name
resolves to a public channel.

**Fix.** Set `GAMEREG_CHECKIN_CHANNEL` and `GAMEREG_CHECKIN_TO`, which the
wrapper turns into explicit reply routing.

### The check-in arrives in the wrong language

**Cause.** A wake has no conversation to infer a language from.

**Fix.** The wrapper states the register's configured locale as a fact; check
`gamereg vocab --json` and `locale` in `gamereg.config.json`.

### Check-ins claim in the log to have come from a conversation

**Cause.** A cron job inherits the gateway's environment, including
`GAMEREG_SOURCE=chat`.

**Fix.** Already handled: the wrapper sets `cron` itself. If you call the CLI
from your own script, set it there too.

### A cron job sends its own stdout to the chat

**Cause.** A command job's delivery mode defaults to announcing its output.

**Fix.** Register it with `--no-deliver`. Delivery failing also marks the run
`status: "error"` even when the command exited 0.

### `openclaw agent` refuses with `No target session selected`

**Cause.** There is no implicit main session.

**Fix.** Pass `--agent <id>`.

### Changing `GAMEREG_CHECKIN_CRON` or `GAMEREG_CHECKIN_TO` does nothing

**Cause.** `provision` registers the job only when no job of that name exists.

**Fix.** Delete the job and restart the service:

```bash
docker compose exec gateway openclaw cron rm gamereg-checkin
docker compose up -d provision
```

### A test check-in filed a break on a real session

**Cause.** A scratch vault isolates the wrapper, not the agent: the wrapper
reads `GAMEREG_VAULT` from its own environment, while the agent reads it from
the gateway process.

**Fix.** Preview with `--dry-run --at`, and test an actual answer only against
the real vault, on a session you are willing to have a break filed against.
Note that a dry run still runs the reply-window sweep, which can amend stale
check-ins.

## Container

### The gateway restarts every minute or so, and each boot passes the health check

**Cause.** Memory. It idles near its limit and restarts itself under its own
memory-pressure check.

**Fix.** Raise `GATEWAY_MEM_LIMIT` (`1g` is the floor) and add swap
([ADR 0092](../decisions/0092-openclaw-pinned-with-1g-floor.md)).

### The gateway never becomes healthy on a slow machine

**Cause.** The first boot is slower than the start period allows.

**Fix.** Raise `GATEWAY_START_PERIOD`. Never shorten the health check interval:
a check that costs more than its interval is an outage generator
([ADR 0082](../decisions/0082-health-check-is-a-tcp-connect.md)).

### Every CLI client gets `token_mismatch` while the gateway is healthy

**Cause.** The token in the configuration and the one in
`/config/.gateway-token` disagree.

**Fix.** The file is the authority and the entrypoint restates it into the
configuration on every boot: restart the gateway.

### The container will not boot after an OpenClaw upgrade, or boots and fails every message

**Cause.** Two migrations. A configuration key the old version wrote can stop
being recognised, which kills the boot-time patch; and the exec allowlist moved
into the gateway's database, where a legacy file left in place raises
`ExecApprovalsMigrationRequiredError` while the gateway looks healthy.

**Fix.** Both are handled at boot (`openclaw doctor --fix`, then the allowlist
is written through the CLI rather than copied as a file). If you manage a host
install, do the same there: ask the installed CLI to write its own store.

### The stack runs the previous version after an upgrade

**Cause.** `up -d` keeps the image it has; `:edge` moves.

**Fix.** `docker compose pull && docker compose up -d`, then `/reset` the
conversation.

### The first push fails with `Host key verification failed`

**Cause.** `config/ssh/` did not exist when the stack started, so Docker
created it owned by root, or `known_hosts` is missing. Host key checking is
strict, so it fails immediately instead of prompting.

**Fix.** Populate the directory (`ssh-keyscan github.com > config/ssh/known_hosts`),
fixing ownership if needed, and recreate the service.

### The vault never becomes a git repository

**Cause.** The boot creates a repository only for a vault it seeds itself. A
vault that already has `gamereg.config.json` but no `.git` is left alone, and
the maintenance loop then has no state to work from.

**Fix.** `git -C vault init && git -C vault add -A && git -C vault commit -m
"chore(vault): initial commit"`.

### The nightly dream diary comes back after you re-enable it

**Cause.** The boot overlay disables `memory-core`'s dreaming sweep on every
start, so a change in the configuration file does not survive a restart
([ADR 0098](../decisions/0098-dreaming-disabled.md)).

## Site and comments

### `site-build` exits 2 immediately

**Cause.** Either the vault has no `quartz/quartz.config.yaml` (the `quartz`
target has never run) or `quartz/` holds no Quartz checkout (nothing was
vendored).

**Fix.** `gamereg build quartz`, then vendor Quartz. See
[Publish a site](publish-site.md).

### The site build fails on a missing dependency, repeatedly

**Cause.** An interrupted `npm install` leaves `node_modules` incomplete, and
installing over it does not repair it.

**Fix.** Delete the build tree's `node_modules` — it lives in the site cache
directory (`./cache/quartz-build` by default), not in the vault, which is
mounted read-only.

### Pages load but internal links 404

**Cause.** Quartz emits `stats.html` and links to `/stats`, and emits both
`tags/<tag>.html` and a `tags/<tag>/` directory.

**Fix.** The generated `Caddyfile` already tries `{path}.html` before
`{path}/index.html`. If you serve the site elsewhere, reproduce that order.

### The comments widget does not appear

**Cause.** The plugin's `host` and `REMARK_URL` disagree, so the widget loads
from one address while Remark42 believes it lives at another. Nothing errors.

**Fix.** Make them equal, including the `/remark42` path when the comments are
proxied under the site's origin. Check `ALLOWED_HOSTS` too: it names the
origins allowed to embed the threads, and the shipped example is a placeholder
hostname.

### A sign-in method is offered and fails

**Cause.** Remark42 reads a variable's *presence* as enable, so
`AUTH_TELEGRAM=""` advertises a method that cannot work, and an OAuth provider
set in `.env` but not named in `compose.yml` does nothing at all.

**Fix.** Boolean flags take an explicit `false`; a provider needs both its
variables in `.env` and its line in `compose.yml`
([ADR 0089](../decisions/0089-public-service-gets-named-variables.md)). Telegram
sign-in needs `AUTH_TELEGRAM=true` and its own second bot token.
