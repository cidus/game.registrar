#!/bin/sh
#
# Container boot for the Registrar (06-roadmap.md, phase 4).
#
# Everything a host currently supplies by hand -- agent/README.md's eleven
# steps -- has to happen on every boot instead, idempotently, with no terminal.
# That is the whole job. Invariant 14 is what makes it possible: every
# configurable value can be set without a TTY, so nothing here has to drive a
# prompt.
#
# The one thing this script deliberately does *not* do is register the check-in
# cron job. `openclaw cron add` is a Gateway *client* command -- it connects
# over the WebSocket and talks to a running gateway -- so it cannot run before
# the gateway this script is about to exec. It lives in the `provision` mode
# below, which compose runs as a one-shot service gated on the gateway's own
# health check.
#
# Modes, chosen by the first argument:
#
#   gateway      full boot, then exec the gateway (the default)
#   provision    register the check-in cron job against a running gateway
#   maintenance  git identity only, then exec the enrich/build/commit loop
#   *            exec the arguments verbatim, no setup -- the escape hatch for
#                one-off commands like `gamereg --version`
#
# Test seams, following agent/checkin.sh and scripts/autobuild.sh: the three
# binaries are overridable so a test can stub the ones that would reach a
# gateway or a network, and `--dry-run` performs nothing.

set -u

GAMEREG="${GAMEREG_BIN:-gamereg}"
OPENCLAW="${OPENCLAW_BIN:-openclaw}"
GIT="${GIT_BIN:-git}"

VAULT="${GAMEREG_VAULT:-/vault}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/config}"
DEFAULTS="${GAMEREG_AGENT_DEFAULTS:-/opt/gamereg/agent-defaults}"
WORKSPACE="$STATE_DIR/workspace"

DRY_RUN=no

log() { echo "entrypoint: $*" >&2; }
die() { log "$*"; exit 2; }
run() {
  if [ "$DRY_RUN" = yes ]; then
    log "would run: $*"
    return 0
  fi
  "$@"
}

# --- 1. required environment -------------------------------------------------
#
# Fatal versus warning follows the CLI's own semantics rather than a taste for
# strictness. A missing bot token means nothing works at all. A missing IGDB
# credential means `enrich` reports the provider unavailable and exits 6, which
# 02-cli.md defines as "the local work was still committed" -- a warning.

preflight() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || die "TELEGRAM_BOT_TOKEN is not set. The gateway has no channel without it."
  [ -n "${TELEGRAM_ALLOW_FROM:-}" ] || die "TELEGRAM_ALLOW_FROM is not set. Refusing to start a bot with shell access and no sender allowlist."

  case "${TELEGRAM_ALLOW_FROM}" in
    *[!0-9]*) die "TELEGRAM_ALLOW_FROM must be the numeric chat id, not a @username." ;;
  esac

  [ -d "$VAULT" ] || die "vault directory $VAULT does not exist. Mount it."
  [ -w "$VAULT" ] || die "vault directory $VAULT is not writable by uid $(id -u). Check the compose \`user:\` against the directory owner."

  if [ -z "${IGDB_CLIENT_ID:-}" ] || [ -z "${IGDB_CLIENT_SECRET:-}" ]; then
    log "note: no IGDB credentials; enrichment will report the provider unavailable and everything else still works."
  fi
}

# --- 2. git ------------------------------------------------------------------
#
# Two failures that are invisible until the first maintenance tick and then
# read as something else entirely.
#
# `safe.directory`: the vault is a bind mount, so its owner is a host uid that
# git compares against its own and refuses -- "detected dubious ownership" --
# before doing anything. It fails the same way for a clean repository and a
# broken one.
#
# Identity: scripts/autobuild.sh ends in `git commit`, which aborts with
# "Please tell me who you are" when neither user.email nor user.name is set. A
# single-user host has both by accident; a container has neither.

configure_git() {
  if ! "$GIT" config --global --get-all safe.directory 2>/dev/null | grep -qx "$VAULT"; then
    run "$GIT" config --global --add safe.directory "$VAULT"
  fi
  run "$GIT" config --global user.name "${GAMEREG_GIT_NAME:-gamereg}"
  run "$GIT" config --global user.email "${GAMEREG_GIT_EMAIL:-gamereg@localhost}"

  # A push needs a key and a host it already trusts. Without the second half a
  # first push blocks on an interactive fingerprint prompt that nobody answers.
  if [ -f "${GAMEREG_SSH_KEY:-/config/ssh/id_ed25519}" ]; then
    export GIT_SSH_COMMAND="ssh -i ${GAMEREG_SSH_KEY:-/config/ssh/id_ed25519} -o IdentitiesOnly=yes -o UserKnownHostsFile=${GAMEREG_SSH_KNOWN_HOSTS:-/config/ssh/known_hosts} -o StrictHostKeyChecking=yes"
  fi
}

# --- 3. the vault ------------------------------------------------------------
#
# `gamereg init` writes exactly three files and refuses an existing vault
# without --yes, so the guard is the config file's presence rather than a
# sentinel of our own. A vault that already exists is never touched.

seed_vault() {
  if [ -f "$VAULT/gamereg.config.json" ]; then
    log "vault already initialised, leaving it alone"
    return 0
  fi

  log "empty vault, initialising"
  set -- init --vault "$VAULT" --json
  [ -n "${GAMEREG_TIMEZONE:-}" ] && set -- "$@" --timezone "$GAMEREG_TIMEZONE"
  [ -n "${GAMEREG_DAY_CUTOFF:-}" ] && set -- "$@" --day-cutoff "$GAMEREG_DAY_CUTOFF"
  [ -n "${GAMEREG_TARGETS:-}" ] && set -- "$@" --targets "$GAMEREG_TARGETS"
  [ -n "${GAMEREG_PLATFORMS:-}" ] && set -- "$@" --platforms "$GAMEREG_PLATFORMS"
  [ -n "${GAMEREG_LOCALE:-}" ] && set -- "$@" --locale "$GAMEREG_LOCALE"
  run "$GAMEREG" "$@" >/dev/null || die "gamereg init failed"

  if [ ! -d "$VAULT/.git" ]; then
    log "vault is not a git repository, creating one"
    run "$GIT" -C "$VAULT" init -q

    # And commit what init just wrote, which matters more than it looks.
    # scripts/autobuild.sh uses "is the working tree dirty" as its entire
    # state, and it only ever stages build output and the event log -- never
    # gamereg.config.json or .gitignore, which are not artifacts. Left
    # uncommitted those two make the tree permanently dirty, so every tick
    # forever runs an enrich that reaches the network and a build that has
    # nothing to do. On a host a person commits them without thinking about
    # it; nobody is here to.
    run "$GIT" -C "$VAULT" add -A
    run "$GIT" -C "$VAULT" commit -q -m "chore(vault): initial commit" \
      || log "nothing to commit in the new vault"
  fi
}

# --- 4. what the agent reads -------------------------------------------------
#
# The same split targets/ already draws between write policies, applied to the
# gateway's workspace. The skill is code: replaced on every boot, so pulling a
# new image actually redeploys it. The persona files are the user's the moment
# they touch them: seeded once and never overwritten.
#
# Real copies, never symlinks. OpenClaw's skill loader realpaths anything under
# the workspace and refuses a path that resolves outside its root -- tried on a
# live host, and the log line is `reason=symlink-escape`.
#
# What this cannot fix: a conversation already under way keeps the copy it
# loaded. After an image upgrade the running session needs `/reset`.

deploy_agent_files() {
  run mkdir -p "$WORKSPACE/skills"

  log "deploying skills (replaced every boot)"
  run rm -rf "$WORKSPACE/skills/gamereg"
  run cp -R "$DEFAULTS/skills/gamereg" "$WORKSPACE/skills/gamereg"

  for f in "$DEFAULTS"/workspace/*.md; do
    [ -e "$f" ] || continue
    target="$WORKSPACE/$(basename "$f")"
    if [ -e "$target" ]; then
      log "keeping existing $(basename "$f")"
    else
      run cp "$f" "$target"
    fi
  done
}

# --- 3b. the gateway's own token ---------------------------------------------
#
# OpenClaw detects a container and switches its bind from loopback to 0.0.0.0,
# for port-forwarding compatibility, and then refuses to start without auth --
# correctly, since binding a gateway with shell access to every interface
# unauthenticated is not a thing anyone wants by accident.
#
# So a token is mandatory, and asking a person to invent one is a step that
# earns nothing: it is a local secret shared between two containers that
# already share a volume. Generated once into /config, reused forever, and
# overridable for anyone who would rather manage it themselves.
#
# It is also what lets `provision` register the cron job at all: `cron add`
# opens an authenticated websocket, and without this it fails with
# GatewayCredentialsRequiredError.

resolve_gateway_token() {
  if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
    return 0
  fi

  token_file="$STATE_DIR/.gateway-token"
  if [ ! -f "$token_file" ]; then
    [ "$DRY_RUN" = yes ] && { log "would generate a gateway token"; return 0; }
    log "generating a gateway token"
    mkdir -p "$STATE_DIR"
    node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' > "$token_file" \
      || die "could not generate a gateway token"
    chmod 600 "$token_file"
  fi

  OPENCLAW_GATEWAY_TOKEN="$(cat "$token_file")"
  export OPENCLAW_GATEWAY_TOKEN
}

# --- 4b. the model credential ------------------------------------------------
#
# The gap that is invisible until the first message: a gateway with a channel,
# a skill and a vault, and no model behind it. It starts cleanly and answers
# nothing.
#
# This does not go through `config patch` -- model auth is `openclaw onboard`'s
# business, and onboard is the only command that knows how to write the
# credential store. `--non-interactive` requires `--accept-risk`, and the
# skips matter: the daemon is this container, the channel is configured by the
# patch below, and `--skip-bootstrap` keeps OpenClaw from seeding its own
# default workspace files ahead of ours -- an existing file is one the deploy
# step above will not replace, so a default AGENTS.md written here would win
# permanently.
#
# Run once, guarded by the credential store's own presence. Re-running onboard
# against a configured install is not a no-op.

configure_model_auth() {
  if [ -f "$STATE_DIR/.gamereg-auth-seeded" ]; then
    return 0
  fi

  if [ -z "${OPENCLAW_AUTH_KEY:-}" ]; then
    log "no OPENCLAW_AUTH_KEY set: the gateway will start, the agent will not answer."
    log "provision it once with: docker compose exec gateway openclaw onboard"
    return 0
  fi

  case "${OPENCLAW_AUTH_CHOICE:-apiKey}" in
    apiKey|anthropic*) key_flag=--anthropic-api-key ;;
    openrouter*)       key_flag=--openrouter-api-key ;;
    *)                 key_flag=--custom-api-key ;;
  esac

  log "provisioning model auth (${OPENCLAW_AUTH_CHOICE:-apiKey})"
  run "$OPENCLAW" onboard --non-interactive --accept-risk \
      --flow manual --skip-channels --skip-daemon --no-install-daemon \
      --skip-bootstrap \
      --auth-choice "${OPENCLAW_AUTH_CHOICE:-apiKey}" \
      "$key_flag" "$OPENCLAW_AUTH_KEY" \
      || die "openclaw onboard failed -- run it by hand with 'docker compose exec gateway openclaw onboard'"

  run touch "$STATE_DIR/.gamereg-auth-seeded"
}

# --- 5. the gateway's own configuration --------------------------------------
#
# Two patches, and the order is the point. The shipped example carries the
# structure and every key that was verified against a real install; it is
# seeded once, so a user who edits the progress label or the model keeps that
# edit across restarts. The env overlay carries only what belongs to this
# installation and is applied every boot, so changing a chat id in .env and
# restarting is enough to move it.
#
# `config patch` merges objects recursively and replaces arrays, which is
# exactly the shape wanted here: allowFrom is replaced wholesale, everything
# else is left alone.

configure_gateway() {
  run mkdir -p "$STATE_DIR"

  if [ ! -f "$STATE_DIR/.gamereg-config-seeded" ]; then
    log "seeding gateway configuration"
    run "$OPENCLAW" config patch --file "$DEFAULTS/openclaw.json5" || die "openclaw config patch failed"
    run touch "$STATE_DIR/.gamereg-config-seeded"
  fi

  log "applying environment overlay"
  if [ "$DRY_RUN" = yes ]; then
    log "would patch botToken, allowFrom and execApprovals.approvers from the environment"
  else
    printf '{
  // The gateway refuses to start without this and says so in a way that reads
  // as a damaged install: "existing config is missing gateway.mode. Treat this
  // as suspicious or clobbered config." The shipped example never carried it
  // because it was written to be patched onto a host that had already been
  // through `openclaw onboard`; in a container there is no already.
  gateway: { mode: "local" },
  channels: {
    telegram: {
      enabled: true,
      botToken: "%s",
      dmPolicy: "allowlist",
      allowFrom: ["%s"],
      execApprovals: { enabled: true, approvers: ["%s"] },
    },
  },
}\n' "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_ALLOW_FROM" "$TELEGRAM_ALLOW_FROM" \
      | "$OPENCLAW" config patch --stdin || die "openclaw config patch --stdin failed"
  fi

  # The exec allowlist. Seeded rather than replaced for the same reason as the
  # config: an installation may add a binary of its own. The shipped file has a
  # placeholder absolute path for a host install, which is meaningless here --
  # in the image `gamereg` is on PATH and the bare-name pattern is the one that
  # ever matched anyway.
  if [ ! -f "$STATE_DIR/exec-approvals.json" ]; then
    log "seeding the exec allowlist"
    run cp "$DEFAULTS/exec-approvals.json" "$STATE_DIR/exec-approvals.json"
  fi
}

# --- 6. the check-in cron job ------------------------------------------------
#
# Runs against an already-healthy gateway, from the `provision` service.
#
# `--exact` and an hourly cron string rather than `--every 1h`: `--every` counts
# from the moment of registration, so a job created at 09:58 polls at 09:58
# forever, and `chase_at` is a delivery slot -- an unaligned tick delivers the
# morning chase 58 minutes late. `--no-deliver` because a command job's stdout
# is otherwise sent to the user as raw text, which is why checkin.sh keeps its
# stdout empty on every path.

register_cron() {
  name="${GAMEREG_CHECKIN_JOB:-gamereg-checkin}"

  # Two containers, so the gateway is a hostname and not localhost, and the
  # token resolved above is what gets past the credentials check.
  if [ -n "${OPENCLAW_GATEWAY_URL:-}" ]; then
    set -- --url "$OPENCLAW_GATEWAY_URL"
  else
    set --
  fi
  [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ] && set -- "$@" --token "$OPENCLAW_GATEWAY_TOKEN"
  CLIENT_ARGS="$*"

  if "$OPENCLAW" cron list --all --json $CLIENT_ARGS 2>/dev/null | grep -q "\"$name\""; then
    log "cron job $name already registered"
    return 0
  fi

  log "registering cron job $name"
  set -- cron add --name "$name" --cron "${GAMEREG_CHECKIN_CRON:-0 * * * *}" \
      --exact --no-deliver \
      --agent "${OPENCLAW_AGENT:-main}" \
      --command-env "GAMEREG_VAULT=$VAULT" \
      --command "/usr/local/bin/gamereg-checkin"
  if [ -n "${GAMEREG_CHECKIN_CHANNEL:-}" ]; then
    set -- "$@" --command-env "GAMEREG_CHECKIN_CHANNEL=$GAMEREG_CHECKIN_CHANNEL"
  fi
  if [ -n "${GAMEREG_CHECKIN_TO:-}" ]; then
    set -- "$@" --command-env "GAMEREG_CHECKIN_TO=$GAMEREG_CHECKIN_TO"
  fi
  # shellcheck disable=SC2086 -- CLIENT_ARGS is deliberately word-split
  run "$OPENCLAW" "$@" $CLIENT_ARGS || die "cron registration failed"
}

# --- dispatch ----------------------------------------------------------------

MODE="${1:-gateway}"
[ $# -gt 0 ] && shift

for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN=yes
done

case "$MODE" in
  gateway)
    preflight
    configure_git
    seed_vault
    resolve_gateway_token
    configure_model_auth
    deploy_agent_files
    configure_gateway
    [ "$DRY_RUN" = yes ] && { log "dry run complete, not starting the gateway"; exit 0; }
    log "starting the gateway"
    exec "$OPENCLAW" gateway run
    ;;
  provision)
    resolve_gateway_token
    register_cron
    ;;
  maintenance)
    configure_git
    [ "$DRY_RUN" = yes ] && { log "dry run complete, not starting the loop"; exit 0; }
    exec /usr/local/bin/gamereg-loop
    ;;
  *)
    exec "$MODE" "$@"
    ;;
esac
