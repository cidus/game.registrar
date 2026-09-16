# Set up the chat agent

The agent turns a message like "starting hollow knight" into `gamereg start
"hollow knight"`, in whatever language you wrote it, and relays what the CLI
answers. It never writes vault files, computes a duration or invents an
identifier — every number it reports came from the database, because it has to
ask the CLI like any other caller. It can also speak first, when the optional
check-in poll finds a session that has been open too long.

For how the layer is shaped and why, read
[docs/explanation/agent-design.md](../explanation/agent-design.md); the
normative description is [docs/spec/05-agent.md](../spec/05-agent.md).

## Choose how to run it

| How | Use it when | Guide |
|---|---|---|
| Container | Almost always. One image holds the CLI and the gateway; every boot seeds the vault, installs the model credential and redeploys the prompt. | [deploy-container.md](deploy-container.md) |
| Host install | You already run a gateway, or you want the pieces on a machine you manage by hand. | [deploy-host.md](deploy-host.md) |

Both deployments run the same CLI, the same prompt files and the same check-in
wrapper. The container does by itself what the host guide asks you to do once
per step.

## Requirements

- **A gateway that can execute a command.** It receives messages, runs the
  model and shells out. [OpenClaw](https://openclaw.ai) is the reference
  deployment and the one this repository ships configuration for, but nothing
  in the design depends on it.
- **A model with tool calling and reliable instruction following.** It builds
  CLI invocations and writes SQL against a documented schema. A model that
  improvises produces invocations that fail loudly rather than data that is
  quietly wrong, but it will annoy you. Image input is needed only if you want
  to send screenshots and box photos.
- **An always-on machine**, if you want to message the register while away from
  your desk. A mini PC, an old laptop or a small VPS is enough.

The contract is the CLI's JSON output, not any vendor's API, so hosted and
local models are both fine. Pick during your gateway's own setup.

## Voice

Voice notes are transcribed **in the gateway, before `gamereg` sees anything**.
The CLI never touches audio and must never be asked to.

`tools.media.audio` in
[agent/openclaw.example.json5](../../agent/openclaw.example.json5) selects the
transcriber. Two entries are written there, and you pick one:

| Option | Trade-off |
|---|---|
| Hosted (shipped, uncommented) | Better on pt-BR out of the box. The audio leaves the machine. The shipped entry is `openrouter` with `openai/whisper-large-v3-turbo`. |
| Local (shipped, commented out) | Nothing leaves the host and there is no per-minute cost, at the price of more setup. It is a `cli` entry that shells out to `whisper-cli`; `ffmpeg` must also be on `PATH`, because OpenClaw decodes the incoming audio before handing it over. |

There is no `whisper-local` provider id — local Whisper is the CLI entry, not a
provider.

Transcribed game titles are unreliable whichever you choose. That is what
`gamereg alias` is for: correct a mangled title once and the register knows it
from then on.

```bash
gamereg alias "hollow knight" --add "holo naipe"
```

## Check-ins

A session left open too long, or still open the next morning, gets one
question: the register asks whether you are still playing, taking a break, or
finished. You answer in plain text.

**The CLI decides when, not the model.** `gamereg due` evaluates the triggers,
the quiet hours, the backoff ladder and the per-session ceiling; the poll only
relays the answer. A poll that finds nothing says nothing at all, which is what
makes an hourly schedule affordable.

A check-in carries no buttons, and arrives exactly once. Why:
[ADR 0059](../decisions/0059-checkins-have-no-buttons.md).

Configuration keys are in
[docs/reference/configuration.md](../reference/configuration.md#checkin).

Wiring the poll differs by deployment:

- **Container** — the `provision` service registers the job against the running
  gateway on first boot. Nothing to do.
- **Host install** — you register it by hand, once. See
  [deploy-host.md](deploy-host.md).

## Reactions and stickers

The register can mark a filing with a sticker or an emoji reaction. Five tokens
exist — `filed`, `approved`, `archived`, `pending`, `puzzled` — and
[agent/workspace/REACTIONS.md](../../agent/workspace/REACTIONS.md) maps each to
an asset for your installation. It ships with an emoji per row and no stickers.

> [!WARNING]
> The five tokens are identifiers and are never translated. A translated token
> matches no row, and the reaction silently does not happen. Why:
> [ADR 0045](../decisions/0045-reaction-tokens-never-translated.md).

A reaction is a second tool call, not something that rides along with a reply.
Why: [ADR 0044](../decisions/0044-reactions-are-a-second-call.md).

Two gateway switches are off by default and must be turned on before anything
reaches a chat:

| Path | Switch | Notes |
|---|---|---|
| Sticker | `channels.telegram.actions.sticker` | Gates `action: "sendSticker"`, which needs a `fileId`. |
| Emoji reaction | `channels.telegram.actions.reactions` **and** `reactionLevel` above `"off"` | Gated twice. `reactionLevel` is OpenClaw's own knob for how freely the agent reacts, and it governs more than these five tokens. |

Both are carried, commented out, in
[agent/openclaw.example.json5](../../agent/openclaw.example.json5).

To fill in the sticker column:

1. Send the sticker to your bot from your own account.
2. Read the `file_id` off the update the bot receives.
3. Put it in the token's row in `REACTIONS.md`.

A `file_id` is issued per bot, so the table does not survive replacing the bot.
No artwork ships in this repository and none will.

## Smoke test

From your phone, no terminal, in whatever language you actually use. The bot's
words come from `gamereg vocab` in that language; an English term like "filed"
landing mid-sentence means the prompt did not deploy as edited.

1. "starting hollow knight" → a session opens, and you are *not* asked for a
   platform.
2. Send a photo mid-session → it is held for the close.
3. A voice note: "just stopped, got to the Watcher Knights" → the session
   closes, the note is your words, and the platform question arrives *now*.
4. A title matching several games → inline buttons, one tap, no retyping.
5. "done, 9 out of 10, hard" → the run closes.
6. Accept a drafted verdict → filed as written.
7. "how many hours did I play this year?" → a number that came from SQL.

On a fresh vault, step 7 also exercises `data/log.db` not existing yet: the
agent should run `gamereg build` itself and retry, rather than reporting a dead
end.

### Confirm what the register recorded

Event source is stored in `data/events.jsonl` and in the SQLite `events` table.
It is not rendered into any note, so read it from one of those:

```bash
gamereg query "SELECT ts, type, source FROM events ORDER BY ts DESC LIMIT 10"
```

Everything filed through the chat shows `source` as `chat`.

### The check-in

This is the one step that cannot start from the phone.

> [!WARNING]
> `--dry-run` does not touch the gateway, but it is not read-only: the
> reply-window sweep (`gamereg checkin --expire`) runs before the dry-run check
> and files an `event.amend` for any check-in that has outlived its window.

> [!WARNING]
> The wrapper reads `GAMEREG_VAULT` from its own environment; the *agent* reads
> it from the gateway process. A scratch vault therefore isolates the question
> and not the answer. Run the real test against the **real vault**, on a session
> you are willing to have a break filed against — or repoint the gateway and
> restart it.

Both commands need `GAMEREG_VAULT` set in the shell, even when the gateway
already has it:

```bash
GAMEREG_VAULT=/path/to/your/vault ~/.openclaw/checkin.sh --dry-run --at "2026-08-23 09:00"
GAMEREG_VAULT=/path/to/your/vault ~/.openclaw/checkin.sh
```

In the container, run the wrapper as `/usr/local/bin/gamereg-checkin` inside
the gateway service instead.

The message should arrive **once**, name the game and how long it has been
open, and read as an offer rather than a verdict. Answer it in plain text
("pausa", "encerrei às 22h", or nothing at all), then check the log for three
events:

```bash
gamereg query "SELECT ts, type, source FROM events ORDER BY ts DESC LIMIT 5"
```

- a `session.checkin` with `source` = `cron`
- a `break.open`
- an `event.amend` moving the check-in's outcome to `break_started`

The last is the one worth checking. It is the agent's only bookkeeping, it
needs an id nothing handed it, and it is what gets skipped when anything
upstream went wrong.

### Who may talk to it

Message the bot from another account. What should happen depends on the policy
you set:

| `dmPolicy` | A stranger gets |
|---|---|
| `allowlist` | Nothing. The message is refused in silence. |
| `pairing` | A reply carrying their own numeric id, a one-time code, and the command an operator runs to approve them. |

Why the two are alternatives rather than stages:
[ADR 0080](../decisions/0080-telegram-pairing-reveals-the-sender-id.md).

## Next steps

- [deploy-container.md](deploy-container.md) — the recommended deployment.
- [deploy-host.md](deploy-host.md) — the host install, step by step.
- [troubleshooting.md](troubleshooting.md) — indexed by symptom.
- [docs/explanation/agent-design.md](../explanation/agent-design.md) — how the
  prompt, the boundary and the check-in state machine fit together.
- [agent/README.md](../../agent/README.md) — what is in `agent/` and where each
  file is deployed.
