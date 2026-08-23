#!/bin/sh
#
# The check-in poll (docs/spec/05-agent.md, *Check-ins*).
#
# This is the gateway's file, not the agent's. It runs hourly as an OpenClaw
# cron *command* job -- the binary with no model attached -- so a poll that
# finds nothing costs nothing, which is the whole reason hourly is affordable.
# See agent/README.md for how it is registered and what was verified live.
#
# It decides nothing. `gamereg due` decides whether there is anything to say;
# this script relays the answer and records that it did:
#
#   1. `gamereg checkin --expire`  -- silence is an answer, filed as `no_reply`
#   2. `gamereg due --json`        -- what is due right now
#   3. empty                       -- exit, saying nothing at all
#   4. non-empty                   -- wake the agent with the facts already
#                                     fetched, all rows in one message
#   5. `gamereg checkin ... --outcome snoozed` for each row, *after* the wake
#
# **Step 5 comes after step 4, and that order is load-bearing.** Filing first
# would put a session inside its backoff window having never been asked. The
# intended failure mode is the other one: forgetting to record a check-in makes
# the Registrar repeat itself, and a repeat costs one message where a false
# silence costs a closing time nobody will remember.
#
# **stdout stays empty, on both paths.** A cron command job delivers its output
# to a chat unless the job is registered with `--no-deliver`, so anything
# printed here is one misregistered job away from being sent to the user as raw
# text. Diagnostics go to stderr, where `openclaw cron runs --id <job>` still
# shows them.
#
# `--dry-run` prints what would be sent and files nothing.

set -u

DRY_RUN=no
AT=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=yes ;;
    # Evaluate as if it were another time. Forwarded to every `gamereg` call
    # below, which is what makes this script testable: the CLI has no clock of
    # its own and `--at` is its whole test harness, and until this existed the
    # wrapper was the one caller that could not use it.
    --at) shift; AT=${1:-}; [ -n "$AT" ] || { echo "checkin.sh: --at needs a time" >&2; exit 2; } ;;
    *) echo "usage: checkin.sh [--dry-run] [--at <when>]" >&2; exit 2 ;;
  esac
  shift
done

# Every `gamereg` call goes through this, so `--at` reaches all three of them or
# none. A function rather than a string of extra arguments: the value carries a
# space, and an unquoted expansion would split it into two.
gamereg_run() {
  if [ -n "$AT" ]; then "$GAMEREG" "$@" --at "$AT"; else "$GAMEREG" "$@"; fi
}

GAMEREG=${GAMEREG_BIN:-gamereg}
OPENCLAW=${OPENCLAW_BIN:-openclaw}

# Which agent to wake. `openclaw agents list` names it; `main` is the default
# agent on a single-agent install. It has to be named: `openclaw agent` with no
# selector at all does not fall back to the main session, it refuses with "No
# target session selected" -- the `(omit to use the main session channel)` in
# its own help is about the delivery channel, not about the session.
OPENCLAW_AGENT=${OPENCLAW_AGENT:-main}

# Where the question is delivered, and the only reason this script knows a chat
# id at all. A turn started by a poll carries no inbound message, so the gateway
# injects no routing into the model's context and the `message` tool has nothing
# to default to -- which is what buttons are sent through. Passing the target on
# the command line puts it back, and the agent then names no target itself.
#
# Both unset is a supported deployment: the question still arrives, as the
# agent's own reply text carried by `--deliver`. What is lost is the buttons, so
# the exits have to be typed.
GAMEREG_CHECKIN_CHANNEL=${GAMEREG_CHECKIN_CHANNEL:-}
GAMEREG_CHECKIN_TO=${GAMEREG_CHECKIN_TO:-}

# The vault is wherever the environment says it is; nothing here is coupled to
# an install path (invariant 15). A command job inherits the gateway process's
# environment, so this is usually already set -- but `openclaw cron add
# --command-env GAMEREG_VAULT=...` sets it explicitly, and an unset vault is a
# misconfiguration to fail on rather than a directory to guess at.
if [ -z "${GAMEREG_VAULT:-}" ]; then
  echo "checkin.sh: GAMEREG_VAULT is not set; nothing to poll." >&2
  exit 2
fi
export GAMEREG_VAULT

# Both of these must be *set here*, not inherited. The gateway process exports
# GAMEREG_SOURCE=chat for the agent's own invocations, a command job inherits
# it, and every check-in this script files would then claim in the log to have
# come from a conversation. `cron` is a real EVENT_SOURCE for exactly this.
GAMEREG_SOURCE=cron
GAMEREG_NON_INTERACTIVE=1
export GAMEREG_SOURCE GAMEREG_NON_INTERACTIVE

# 1. Sweep the questions nobody answered. A failure here is reported and not
#    fatal: recording silence matters less than asking the next question, and
#    whatever broke it will break `due` a line later anyway.
if ! swept=$(gamereg_run checkin --expire --json 2>&1); then
  echo "checkin.sh: gamereg checkin --expire failed: $swept" >&2
fi

# 2. What is due now.
if ! rows=$(gamereg_run due --json 2>&1); then
  echo "checkin.sh: gamereg due failed: $rows" >&2
  exit 1
fi

# Which language to ask in. A wake carries no incoming message, so there is
# nothing to read a language off — and an agent left to work it out goes
# rummaging through session history and memory to guess, which is both slow and
# wrong. The register's configured locale is the one answer the vault actually
# has. Best effort: an older binary without `vocab` costs the line, not the poll.
locale=$("$GAMEREG" vocab --json 2>/dev/null |
  node -e '
    let raw = ""
    process.stdin.on("data", (chunk) => { raw += chunk })
    process.stdin.on("end", () => {
      const tag = JSON.parse(raw).result.locale
      if (typeof tag === "string") process.stdout.write(tag)
    })
  ' 2>/dev/null) || locale=""

work=$(mktemp -d) || exit 1
trap 'rm -rf "$work"' EXIT INT TERM
wake=$work/wake.txt

# The instructions the agent wakes to. Facts only: the register, the phrasing
# and the offer are the model's, per docs/spec/05-agent.md. Written before the
# rows are known so the prose stays readable here rather than inside the JS
# below; the rows are appended verbatim, so this file and `gamereg due` cannot
# drift into two descriptions of one payload.
cat > "$wake" <<'BODY'
gamereg check-in.

The open sessions below are due a question right now. These facts came from
`gamereg due`, which this host has already run for you; the wording, the
register and the offer are yours. Follow the *Check-ins* section of the gamereg
skill.

Do not run `gamereg due` or `gamereg checkin`. Both belong to this poll, which
files the snooze for every session below the moment this message reaches you.
Send one message covering all of them, not one message each.

BODY

if [ -n "$locale" ]; then
  cat >> "$wake" <<BODY
Nothing was said to you, so there is no message to read a language off. The
register is configured for $locale: ask in that language, unless this
conversation has already settled on another one. Do not search session history
or memory to work it out.

BODY
fi

if [ -n "$GAMEREG_CHECKIN_TO" ]; then
  cat >> "$wake" <<'BODY'
Offer the exits as buttons. Send them with the message tool and **do not set
`target`** -- this turn carries its own delivery routing, and a bare channel
name does not resolve to this conversation.

That send is the only thing that reaches anyone: your own reply text is not
delivered on this turn. So the question has to go through the message tool, and
whatever you write around it is seen by nobody. Reply `NO_REPLY`.

BODY
else
  cat >> "$wake" <<'BODY'
Ask in plain text, with no buttons, and send nothing with the message tool: this
poll was given no delivery target, so the message tool cannot reach this
conversation. Your own reply is delivered on its own.

BODY
fi

# One node call: appends the rows to the wake body and prints `<session> <trigger>`
# per row for the loop at the end. Node rather than jq because the host already
# has it -- `gamereg` is a Node program -- and a second dependency for one JSON
# read is a dependency the phase-5 image would have to carry forever.
if ! pairs=$(printf '%s' "$rows" | node -e '
  let raw = ""
  process.stdin.on("data", (chunk) => { raw += chunk })
  process.stdin.on("end", () => {
    const due = JSON.parse(raw).result.due
    if (due.length === 0) return
    require("fs").appendFileSync(process.argv[1], JSON.stringify(due, null, 2) + "\n")
    process.stdout.write(due.map((row) => row.session_id + " " + row.trigger).join("\n") + "\n")
  })
' "$wake" 2>&1); then
  echo "checkin.sh: could not read what gamereg due returned: $pairs" >&2
  exit 1
fi

# 3. Empty is the common answer and the important one: an assistant that pings
#    when it has nothing to ask gets muted within a week, and then the
#    day_cutoff chase stops working too.
[ -n "$pairs" ] || exit 0

if [ "$DRY_RUN" = yes ]; then
  echo "--- would wake the agent with ---" >&2
  cat "$wake" >&2
  echo "--- would then file, in this order ---" >&2
  while read -r session trigger; do
    [ -n "$session" ] || continue
    echo "gamereg checkin $session --trigger $trigger --outcome snoozed" >&2
  done <<PAIRS
$pairs
PAIRS
  exit 0
fi

# 4. The wake. `openclaw agent` runs a turn in that agent's main session, which
#    is what puts the question in the same conversation the answer will arrive
#    in. A cron job cannot do this for us: a command job's output never triggers
#    an agent turn, and a one-shot `--message` job refuses to deliver without an
#    explicit channel and target of its own.
#
#    Exactly one delivery path, and which one depends on the routing.
#
# With a target, the agent sends the question itself through the message tool,
# which is where buttons live -- and `--deliver` must be *off*, because it
# delivers the model's own reply text as well. A model narrating alongside a
# tool call is normal behaviour, and that narration is usually the same sentence
# it just sent: the result is every check-in arriving twice, once with buttons
# and once without. Observed on the first two real ones.
#
# Without a target the message tool cannot reach the conversation, so the
# agent's reply *is* the delivery and `--deliver` is what carries it.
set -- --agent "$OPENCLAW_AGENT" --message-file "$wake" --json
if [ -n "$GAMEREG_CHECKIN_TO" ]; then
  [ -n "$GAMEREG_CHECKIN_CHANNEL" ] && set -- "$@" --reply-channel "$GAMEREG_CHECKIN_CHANNEL"
  set -- "$@" --reply-to "$GAMEREG_CHECKIN_TO"
else
  set -- "$@" --deliver
fi

if ! woken=$("$OPENCLAW" agent "$@" 2>&1); then
  echo "checkin.sh: the wake failed, so nothing was filed: $woken" >&2
  exit 1
fi

# 5. Record that the question was asked. The session is now inside its backoff
#    window. A failure here leaves it eligible again on the next tick, which is
#    the direction this feature is allowed to fail in.
status=0
while read -r session trigger; do
  [ -n "$session" ] || continue
  if ! filed=$(gamereg_run checkin "$session" --trigger "$trigger" --outcome snoozed --json 2>&1); then
    echo "checkin.sh: gamereg checkin $session failed: $filed" >&2
    status=1
  fi
done <<PAIRS
$pairs
PAIRS

exit $status
