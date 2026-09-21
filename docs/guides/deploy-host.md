# Deploy the agent on a host

Install the chat agent directly on a machine, without containers. This is the
path the [container deployment](deploy-container.md) automates; take it when you
want the gateway under your own service manager, or when Docker is not an
option.

Everything here assumes [OpenClaw](https://openclaw.ai) as the gateway. Any
gateway that can execute a command works, but the file names and flags below
are OpenClaw's.

## Before you start

- A machine that stays on, with Node 22.18 or newer and git.
- A register — [create one first](../getting-started.md) if this host has none.
- A Telegram bot token from [@BotFather](https://t.me/botfather), and a bot of
  its own: one gateway per token.
- A model credential for the gateway.

## 1. Install `gamereg`

If more than one account will use the register, install it once for everyone,
so every account resolves the same binary:

```bash
git clone https://github.com/cidus/game.registrar.git
cd game.registrar
npm install
sudo npm install -g .
gamereg --version
```

For a single-user machine `npm link` is enough. Note that it links `dist/`, so
after a `git pull` you must run `npm run build` before the agent sees the new
code.

## 2. Create the bot

Through BotFather. Keep the token, then get your own **numeric** chat id — the
allowlist does not match an `@username`. Message the bot once, then:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
```

It is `result[].message.from.id`. While in BotFather, turn `/setjoingroups`
off: this bot is for direct messages. `/setuserpic` sets the avatar;
[agent/PERSONAS.md](../../agent/PERSONAS.md) has the prompts that generated the
one in use.

## 3. Configure the gateway

[`agent/openclaw.example.json5`](../../agent/openclaw.example.json5) carries the
channel configuration *and* the `tools.exec` policy that step 6 depends on.
Fill in the token and your chat id — it appears twice, in `allowFrom` and in
`execApprovals.approvers` — then apply the whole file:

```bash
openclaw config patch --file agent/openclaw.example.json5 --dry-run
openclaw config patch --file agent/openclaw.example.json5
```

> [!IMPORTANT]
> `dmPolicy: "allowlist"` with your id in `allowFrom` is not optional. Unset,
> it defaults to pairing, which answers a stranger with their own id and a
> one-time code and waits for your approval. Pairing is also the only way to
> *find* your id if `getUpdates` gave you nothing: pair once, read the id, then
> switch — the two lists never merge, so copy the id across by hand
> ([ADR 0080](../decisions/0080-telegram-pairing-reveals-the-sender-id.md)).

## 4. Set the environment the CLI reads

In `~/.openclaw/.env`, not in the gateway's own configuration file:

```bash
cat >> ~/.openclaw/.env <<'EOF'
GAMEREG_VAULT=/path/to/your/register
GAMEREG_SOURCE=chat
GAMEREG_NON_INTERACTIVE=1
EOF
chmod 600 ~/.openclaw/.env
systemctl --user restart openclaw-gateway.service
```

`GAMEREG_SOURCE=chat` stamps every event, so the log says later what came from
a phone and what from a terminal; an unknown value is refused outright, because
the log cannot be rewritten. `GAMEREG_NON_INTERACTIVE=1` stops the CLI waiting
on a prompt nobody can answer. See
[Environment](../reference/environment.md#the-cli).

## 5. Install what the agent reads

Both halves are required: the skill is the procedure, the workspace files are
the standing orders and the persona.

```bash
cp -R agent/skills/gamereg ~/.openclaw/workspace/skills/
cp agent/workspace/*.md ~/.openclaw/workspace/
```

> [!WARNING]
> Use real copies, not symlinks into the checkout: the gateway refuses a skill
> path that escapes its configured root, and the only sign is a line in the log.

Repeat both commands after every update. `AGENTS.md` and `TOOLS.md` are code —
their contents are asserted against the real binary in CI — so a stale copy
means the agent follows the previous release's procedure
([ADR 0095](../decisions/0095-workspace-policy-per-file.md)). The other
workspace files are yours to edit. `PERSONAS.md` is deliberately not deployed:
it is a design document and the agent has no use for it.

## 6. Restrict what it may run

Step 3 set the policy (`tools.exec.mode: "allowlist"`). Add the allowlist
itself, after editing the placeholder path in it to your `gamereg`:

```bash
openclaw approvals set --file agent/approvals.example.json
openclaw approvals get          # confirm what is actually in effect
```

Without `mode: "allowlist"` the default is an unrestricted shell, allowlist
file or not. In allowlist mode anything outside it is refused immediately, as a
plain tool error the agent recovers from. `amend` and `revoke` are on the list
deliberately — see
[ADR 0008](../decisions/0008-amend-revoke-confirmed-in-conversation.md) before
copying the file as-is.

Ask the installed CLI to write its own stores rather than copying files into
place: the exec allowlist moved into the gateway's database in a later release,
and a legacy file left behind is fatal at runtime while the gateway still looks
healthy.

## 7. Register the check-in poll

[`agent/checkin.sh`](../../agent/checkin.sh) runs `gamereg checkin --expire` and
`gamereg due --json`, exits silently when nothing is due, and otherwise wakes
the agent and files a check-in for each row — in that order, so a gateway that
was down leaves the session eligible next tick
([ADR 0031](../decisions/0031-wrapper-files-checkin-after-wake.md)).

Install it, then try it:

```bash
cp agent/checkin.sh ~/.openclaw/checkin.sh
GAMEREG_VAULT=/path/to/your/register ~/.openclaw/checkin.sh --dry-run
GAMEREG_VAULT=/path/to/your/register ~/.openclaw/checkin.sh --dry-run --at "2026-08-23 09:00"
```

`--at` pretends it is another time, which is how the morning chase is
exercised. A dry run files nothing.

Then register it as an hourly **command** job — the binary with no model
attached, which is what makes an empty poll free:

```bash
openclaw cron add --name gamereg-checkin --cron "0 * * * *" --exact --no-deliver \
  --agent main \
  --command-env GAMEREG_VAULT=/path/to/your/register \
  --command-env GAMEREG_CHECKIN_CHANNEL=telegram \
  --command-env GAMEREG_CHECKIN_TO=<your numeric chat id> \
  --command "$HOME/.openclaw/checkin.sh"
```

Every flag is load-bearing:

- **`--cron`, not `--every 1h`.** `--every` counts from registration, so a job
  created at 09:58 polls at 09:58 forever — and the morning chase is a delivery
  slot, so it would arrive 58 minutes late
  ([ADR 0002](../decisions/0002-chase-has-its-own-slot.md)).
- **`--exact`** removes the stagger the gateway otherwise applies.
- **`--no-deliver`**, or the job's own stdout is announced to the chat.
- **`--command-env`**, because inheritance is not a contract and one inherited
  value is actively wrong: the gateway's own `GAMEREG_SOURCE=chat` would make
  every polled check-in claim it came from a conversation
  ([ADR 0042](../decisions/0042-wrapper-stdout-empty-and-source-set.md)).
- **`--agent`**, because there is no implicit session to wake.

`openclaw cron run <id>` fires a job on demand, so creating it `--disabled
--keep-after-run` first makes the whole loop inspectable before it goes live.

## 8. Install the maintenance timer

Nothing to do with the gateway, so a plain systemd user timer keeps the vault
enriched, built, committed and pushed:

```bash
cp scripts/autobuild.sh ~/.local/bin/gamereg-autobuild.sh
chmod +x ~/.local/bin/gamereg-autobuild.sh
mkdir -p ~/.config/systemd/user
cp scripts/gamereg-autobuild.service scripts/gamereg-autobuild.timer ~/.config/systemd/user/
# edit ExecStart and GAMEREG_VAULT in the .service if the defaults do not match
systemctl --user daemon-reload
systemctl --user enable --now gamereg-autobuild.timer
```

The unit's `PATH` must reach `gamereg`, `node` and `git`. Push is a no-op, not
an error, until the vault has a remote
([ADR 0062](../decisions/0062-maintenance-is-an-external-script.md)).

## 9. Optional extras

- **Voice, reactions and the smoke test:** [Chat agent](chat-agent.md).
- **A site:** [Publish a site](publish-site.md).

## Verify

Run the smoke test in [Chat agent](chat-agent.md#smoke-test), then check that a
session recorded from the phone shows up in the log with `source: "chat"`:

```bash
gamereg query "select type, source, at from events order by at desc limit 5"
```

If something behaves oddly, [Troubleshooting](troubleshooting.md) is indexed by
symptom.
