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
#   site         exec the Quartz build loop (the `site` profile)
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

# Escapes a value for a JSON5 double-quoted string. Every interpolation below
# goes through this.
#
# Nothing here is expected to contain a quote or a backslash -- a bot token is
# base64-ish, a chat id is numeric, a model name is a slug -- but "expected"
# is doing real work in that sentence, and the failure is not a syntax error
# somebody notices. `config patch` merges whatever parses, so a value carrying
# `", "admin": true` would add keys to the gateway's configuration rather than
# break it. The values come from .env, which is the operator's own file, so
# this is a robustness boundary and not a privilege one; it costs one sed.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

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

  # With a sender configured the door is shut: `allowlist` honours exactly that
  # id and nothing else. Without one, the honest move is not to refuse -- it is
  # to start in `pairing`, because a person cannot look up their own Telegram
  # user id anywhere. No official client shows it, and the Bot API cannot
  # resolve a @username to one; a bot only ever learns an id from someone who
  # has already written to it. So a gateway that refuses to boot is a gateway
  # that cannot tell you the one thing you need to boot it.
  #
  # In `pairing` it answers a stranger with their own numeric id, a one-time
  # code and the command that approves it. A stranger can therefore queue a
  # request; they cannot get in. Verified live.
  if [ -n "${TELEGRAM_ALLOW_FROM:-}" ]; then
    case "$TELEGRAM_ALLOW_FROM" in
      *[!0-9]*) die "TELEGRAM_ALLOW_FROM must be the numeric chat id, not a @username. A username passes config validation and then matches nobody, so every message would be refused in silence." ;;
    esac
    DM_POLICY=allowlist
  else
    DM_POLICY=pairing
    log "no TELEGRAM_ALLOW_FROM: starting in pairing mode."
    log "message the bot and it will reply with your numeric id and a pairing code."
    log "then either put the id in TELEGRAM_ALLOW_FROM and restart, or run:"
    log "  docker compose exec gateway openclaw pairing approve telegram <code>"
  fi

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
# without --yes, so that guard is the config file's presence rather than a
# sentinel of our own. A vault that already has one is never touched by it.
#
# Whether the vault is a *git* repository is a separate question from whether
# it is initialised, and used to share the same guard -- a vault mounted with
# a config already in place (restored from a backup, copied in by hand, or one
# that predates the container) returned before `git init` ever ran, and
# scripts/autobuild.sh -- which treats "is the working tree dirty" as its
# entire state -- can never pick up a vault with no `.git` at all. So the two
# checks run independently; only the *contents* guard stays tied to the
# config file's presence.

seed_vault() {
  if [ -f "$VAULT/gamereg.config.json" ]; then
    log "vault already initialised, leaving it alone"
  else
    log "empty vault, initialising"
    set -- init --vault "$VAULT" --json
    [ -n "${GAMEREG_TIMEZONE:-}" ] && set -- "$@" --timezone "$GAMEREG_TIMEZONE"
    [ -n "${GAMEREG_DAY_CUTOFF:-}" ] && set -- "$@" --day-cutoff "$GAMEREG_DAY_CUTOFF"
    [ -n "${GAMEREG_TARGETS:-}" ] && set -- "$@" --targets "$GAMEREG_TARGETS"
    [ -n "${GAMEREG_PLATFORMS:-}" ] && set -- "$@" --platforms "$GAMEREG_PLATFORMS"
    [ -n "${GAMEREG_LOCALE:-}" ] && set -- "$@" --locale "$GAMEREG_LOCALE"
    run "$GAMEREG" "$@" >/dev/null || die "gamereg init failed"
  fi

  if [ ! -d "$VAULT/.git" ]; then
    log "vault is not a git repository, creating one"
    run "$GIT" -C "$VAULT" init -q

    # And commit whatever the vault holds, which matters more than it looks.
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
# gateway's workspace -- and applied the way targets/ applies it, per artifact
# rather than per directory. `Game Database.base` is a `seed` living beside
# `replace` notes in one tree; the policy belongs to the file, not the folder.
#
# An earlier version of this drew the line around the directory instead: every
# `workspace/*.md` was persona, seeded once and never overwritten. AGENTS.md is
# on the wrong side of that line. It carries the exec boundary, the exit codes,
# the verified button payloads, the routing table and the confirmation protocol,
# and its contents are asserted against the real binary and the real SQL schema
# in CI. A file whose correctness is enforced by a test is not the user's file,
# and leaving it seeded meant an image upgrade shipped new code with the old
# standing orders -- silently, which is the part that made it expensive.
#
# So: WORKSPACE_REPLACE is code and is copied every boot; everything else is
# seeded, with the hash of what was seeded recorded so a later boot can tell
# "the user edited this" from "the shipped default moved". An untouched file
# then updates itself and nobody has an extra step; an edited one is kept, and
# says so, with the way to take the new version if that is what was wanted.
#
# Real copies, never symlinks. OpenClaw's skill loader realpaths anything under
# the workspace and refuses a path that resolves outside its root -- tried on a
# live host, and the log line is `reason=symlink-escape`.
#
# What this cannot fix: a conversation already under way keeps the copy it
# loaded. After an image upgrade the running session needs `/reset`.

WORKSPACE_REPLACE="AGENTS.md TOOLS.md"
SEED_STATE="$STATE_DIR/.gamereg-seed"

sha_of() { sha256sum "$1" | cut -d' ' -f1; }

workspace_policy() {
  for known in $WORKSPACE_REPLACE; do
    if [ "$known" = "$1" ]; then
      echo replace
      return 0
    fi
  done
  echo seed
}

record_seed() {
  if [ "$DRY_RUN" = yes ]; then
    log "would record the seed hash for $2"
    return 0
  fi
  printf '%s\n' "$3" > "$SEED_STATE/$2.sha256"
}

# Both branches that keep an existing file say so, and say what to do about it.
# A file silently left behind is the exact failure this whole section exists to
# remove; reintroducing it one level down, in a shell conditional instead of a
# directory policy, would be the same bug wearing a different hat.
#
# One `log` per line, never a newline inside one. The first draft embedded it,
# and the continuation came out without the `entrypoint:` prefix -- so the
# sentence explaining *why* the file was kept vanished from `docker logs |
# grep entrypoint`, which is how anyone actually reads a boot. A warning that
# disappears under a filter is most of the way back to no warning at all.
keep_notice() {
  log "NOTICE: $1 $2"
  log "NOTICE: $1 Compare with $DEFAULTS/workspace/$1, or delete it from the workspace"
  log "NOTICE: $1 to take the shipped version on the next boot."
}

# Silent when the file is already what ships, which is the steady state. The
# other two cases are events and say so -- a first boot that logged nothing
# about the card left "did my new AGENTS.md land?" with no line to read, which
# is the question this whole section exists to answer.
deploy_replace() {
  if [ ! -f "$2" ]; then
    log "deploying $3 (replaced every boot)"
  elif ! cmp -s "$1" "$2"; then
    run mkdir -p "$STATE_DIR/backups"
    # Not a *.md name, so a backup never rejoins the system prompt.
    run cp "$2" "$STATE_DIR/backups/$3.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
    log "replacing $3 (previous copy kept under backups/)"
  fi
  run cp "$1" "$2"
}

deploy_seed() {
  shipped=$(sha_of "$1")

  if [ ! -f "$2" ]; then
    log "seeding $3"
    run cp "$1" "$2"
    record_seed "$1" "$3" "$shipped"
    return 0
  fi

  current=$(sha_of "$2")

  # No record: seeded by an image from before this tracking existed. If it is
  # byte-identical to what ships, adopting it is safe and costs nothing. If it
  # is not, there is no way to tell an edit from a default that has since moved
  # -- and recording the current hash would mark somebody's edit as factory,
  # so the next boot would overwrite it. Left alone, loudly.
  if [ ! -f "$SEED_STATE/$3.sha256" ]; then
    if [ "$current" = "$shipped" ]; then
      log "adopting $3 (identical to the shipped default)"
      record_seed "$1" "$3" "$shipped"
    else
      keep_notice "$3" "was not updated: it differs from the shipped default and this install predates seed tracking, so it may carry your own changes."
    fi
    return 0
  fi

  recorded=$(cat "$SEED_STATE/$3.sha256")

  if [ "$current" = "$recorded" ]; then
    if [ "$shipped" != "$recorded" ]; then
      log "updating $3 (unmodified since it was seeded)"
      run cp "$1" "$2"
      record_seed "$1" "$3" "$shipped"
    fi
    return 0
  fi

  if [ "$shipped" != "$recorded" ]; then
    keep_notice "$3" "is yours and the shipped version changed in this image. Keeping yours."
  fi
}

# memory-core's dreaming sweep writes a narrative diary here, which then sits
# in the system prompt of every later turn and grows by an entry per phase per
# night. configure_gateway turns the sweep off; this takes the file it already
# wrote out of the workspace. Moved, never deleted -- it is model-written prose
# about the user's own sessions, and the objection is to where it lives.
retire_dream_diary() {
  [ -f "$WORKSPACE/DREAMS.md" ] || return 0
  keep="$STATE_DIR/DREAMS.md"
  [ -e "$keep" ] && keep="$STATE_DIR/DREAMS.md.$(date -u +%Y%m%dT%H%M%SZ)"
  log "moving DREAMS.md out of the workspace (dreaming is disabled); kept at $keep"
  run mv "$WORKSPACE/DREAMS.md" "$keep"
}

deploy_agent_files() {
  run mkdir -p "$WORKSPACE/skills" "$SEED_STATE"

  log "deploying skills (replaced every boot)"
  run rm -rf "$WORKSPACE/skills/gamereg"
  run cp -R "$DEFAULTS/skills/gamereg" "$WORKSPACE/skills/gamereg"

  for f in "$DEFAULTS"/workspace/*.md; do
    [ -e "$f" ] || continue
    name=$(basename "$f")
    if [ "$(workspace_policy "$name")" = replace ]; then
      deploy_replace "$f" "$WORKSPACE/$name" "$name"
    else
      deploy_seed "$f" "$WORKSPACE/$name" "$name"
    fi
  done

  retire_dream_diary
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
# Run once, guarded by the credential store's own presence -- except the
# token branch below, which is guarded by *what* was seeded rather than
# merely *that* something was: the sentinel holds a hash of the token last
# pasted (never the token itself, which is a secret and has no business in a
# file `docker logs`-adjacent tooling might dump), so replacing an expired
# CLAUDE_CODE_OAUTH_TOKEN in .env and restarting actually repastes it. The
# onboard branch below still returns unconditionally once seeded -- re-running
# onboard against a configured install is not a no-op, and there is no token
# to hash there in the first place.

configure_model_auth() {
  auth_state="$STATE_DIR/.gamereg-auth-seeded"

  # A Claude Code OAuth token authenticates Anthropic here, but only through
  # the auth store -- never through the environment.
  #
  # The distinction cost two wasted deployments to find. Setting the variable
  # and writing an `anthropic:cli` profile into the config is what an already
  # onboarded host looks like, and it authenticates nothing: the gateway starts
  # clean and fails at the first message with `No API key found for provider
  # "anthropic"`, naming the per-agent store it looked in and did not find.
  #
  # `paste-token` is what actually writes that store. It reads the token from
  # stdin, needs no running gateway -- it is a local write, which is why it can
  # live here rather than in `provision` -- and the profile it creates lands on
  # the /config volume, so it survives restarts and image upgrades. Verified on
  # a fresh config: a real turn came back from claude-sonnet-5 with
  # authMode=auth-profile and no fallback.
  #
  # Mint one with `claude setup-token` on a machine where you are signed in.
  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    token_hash=$(printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" | sha256sum | cut -d' ' -f1)

    if [ -f "$auth_state" ] && [ "$(cat "$auth_state")" = "$token_hash" ]; then
      return 0
    fi

    log "claiming the Anthropic subscription from CLAUDE_CODE_OAUTH_TOKEN"
    if [ "$DRY_RUN" = yes ]; then
      log "would paste the token into the auth store"
    else
      printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" \
        | "$OPENCLAW" models auth paste-token --provider anthropic \
            --expires-in "${OPENCLAW_AUTH_EXPIRES_IN:-365d}" >/dev/null \
        || die "could not store the Anthropic token"
      printf '%s\n' "$token_hash" > "$auth_state"
    fi
    return 0
  fi

  if [ -f "$auth_state" ]; then
    return 0
  fi

  # Without a key there is nothing to provision. That is a supported state, not
  # a failure: OpenRouter needs only OPENROUTER_API_KEY in the environment, and
  # an Anthropic subscription is claimed by one interactive login inside the
  # container, which writes the per-agent auth store on the /config volume and
  # therefore survives restarts and image upgrades.
  if [ -z "${OPENCLAW_AUTH_KEY:-}" ]; then
    if [ -z "${OPENROUTER_API_KEY:-}" ]; then
      log "no model credential configured. Either set OPENCLAW_AUTH_KEY with"
      log "OPENCLAW_AUTH_CHOICE, or claim a subscription once with:"
      log "  docker compose exec gateway openclaw models auth login --provider anthropic"
    fi
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

  run touch "$auth_state"
}

# --- 4c. which model ---------------------------------------------------------
#
# Separate from the credential on purpose. They used to be one step, so the
# model was a side effect of whichever auth branch ran, and choosing Anthropic
# after an OpenRouter key was present meant editing the config by hand.
#
# Patched on every boot, like the channel overlay, so changing OPENCLAW_MODEL
# in .env and restarting actually moves it. The default follows whatever
# credential is configured, which is right for a first run and wrong to rely on
# afterwards -- name the model you want.

configure_model() {
  primary="${OPENCLAW_MODEL:-}"
  if [ -z "$primary" ]; then
    if [ -n "${OPENCLAW_AUTH_KEY:-}" ]; then
      case "${OPENCLAW_AUTH_CHOICE:-apiKey}" in
        openrouter*) primary="openrouter/auto" ;;
        *)           primary="anthropic/claude-sonnet-5" ;;
      esac
    elif [ -n "${OPENROUTER_API_KEY:-}" ]; then
      primary="openrouter/auto"
    else
      log "no model configured and no credential to infer one from; leaving it alone"
      return 0
    fi
  fi

  # Comma-separated, because the chain is the only depth left once the
  # same-model retry is off (see configure_provider_retry). A 429 now fails
  # over instead of sleeping, so a second fallback is what a retry used to be
  # -- except it takes a different path rather than waiting on the one that
  # just refused.
  fallbacks=""
  old_ifs=$IFS
  IFS=,
  for entry in ${OPENCLAW_MODEL_FALLBACK:-}; do
    entry=$(printf '%s' "$entry" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [ -n "$entry" ] || continue
    fallbacks="${fallbacks:+$fallbacks, }\"$(json_escape "$entry")\""
  done
  IFS=$old_ifs

  log "model: $primary${OPENCLAW_MODEL_FALLBACK:+ (fallbacks ${OPENCLAW_MODEL_FALLBACK})}"
  if [ "$DRY_RUN" = yes ]; then
    log "would patch the model"
    return 0
  fi

  printf '{ agents: { defaults: { model: {
  primary: "%s",
  fallbacks: [%s],
} } } }\n' "$(json_escape "$primary")" "$fallbacks" \
    | "$OPENCLAW" config patch --stdin || die "could not configure the model"
}


# --- 4d. how long a refused model is waited on -------------------------------
#
# OpenClaw 2026.9.4 retries the *same* model before it will consider the
# fallback chain, and for a 429 it sleeps for whatever the provider's
# `Retry-After` header asks. Anthropic asks for as long as the limit has left
# to run -- 41 to 260 minutes, measured here across five incidents -- while the
# turn itself is abandoned after about six. So the fallback was never reached:
# every rate limit ended in "this turn was interrupted because it stopped
# making progress", with OpenRouter configured, credentialed and idle.
#
# Two details in the upstream code make it worse than a tuning problem. The
# delay is `Math.max(jittered, retryAfterMs)` and only the jitter is capped, so
# the header bypasses the 30s ceiling; and the 90s total-retry budget is
# disabled precisely for `rate_limit`, which is the reason that ceiling existed.
# The escape hatch upstream does have -- a "long window" classifier -- reads the
# error *text*, and Anthropic's is generic ("This request would exceed your
# account's rate limit"), so it never fires. None of this existed in 2026.7.1-2.
#
# There is no per-provider setting: `settings.retry.provider` names the layer,
# not the vendor, and the resolver takes no provider argument. So the budget
# goes to zero for everything, and `configure_model` grows a comma-separated
# chain to compensate -- depth in the chain does what retries used to do,
# without waiting on the model that just refused.
#
# Merged rather than written: OpenClaw persists its own settings in this file.

configure_provider_retry() {
  retries="${OPENCLAW_PROVIDER_MAX_RETRIES:-0}"
  settings="$STATE_DIR/agents/${OPENCLAW_AGENT:-main}/agent/settings.json"

  log "provider retry budget: $retries"
  if [ "$DRY_RUN" = yes ]; then
    log "would merge retry.provider.maxRetries into $settings"
    return 0
  fi

  run mkdir -p "$(dirname "$settings")"
  SETTINGS_PATH="$settings" MAX_RETRIES="$retries" node -e '
    const fs = require("node:fs")
    const path = process.env.SETTINGS_PATH
    let settings = {}
    try {
      settings = JSON.parse(fs.readFileSync(path, "utf8"))
      if (settings === null || typeof settings !== "object" || Array.isArray(settings)) settings = {}
    } catch {}
    settings.retry = { ...settings.retry, provider: { ...settings.retry?.provider, maxRetries: Number(process.env.MAX_RETRIES) } }
    fs.writeFileSync(path, JSON.stringify(settings, null, 2) + "\n")
  ' || die "could not write $settings"
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

# A saved config written by an older OpenClaw can stop validating after an
# upgrade: a key it used to write itself is simply no longer recognized, and
# every `config patch` below then fails. Seen on 2026.7.1-2 -> 2026.9.4, where
# `meta.lastTouchedAt` -- OpenClaw's own bookkeeping, not ours -- became an
# unrecognized key and the container would not boot at all.
#
# `doctor --fix` is OpenClaw's own sanctioned repair and is what its error
# message tells you to run. It is attempted only when validation actually
# fails, it is loud about it, and a config still invalid afterwards is still
# fatal -- this recovers from a schema migration, it does not paper over a
# broken config.
repair_config_if_stale() {
  [ -f "${OPENCLAW_CONFIG_PATH:-$STATE_DIR/openclaw.json}" ] || return 0
  "$OPENCLAW" config validate >/dev/null 2>&1 && return 0

  log "saved configuration does not validate against this OpenClaw; running doctor --fix"
  run "$OPENCLAW" doctor --fix >/dev/null 2>&1 || true
  [ "$DRY_RUN" = yes ] && return 0

  "$OPENCLAW" config validate >/dev/null 2>&1 \
    || die "configuration still invalid after doctor --fix; inspect with 'openclaw config validate'"
  log "configuration repaired"
}

configure_gateway() {
  run mkdir -p "$STATE_DIR"

  if [ ! -f "$STATE_DIR/.gamereg-config-seeded" ]; then
    log "seeding gateway configuration"
    run "$OPENCLAW" config patch --file "$DEFAULTS/openclaw.json5" || die "openclaw config patch failed"
    run touch "$STATE_DIR/.gamereg-config-seeded"
  fi

  # The workspace path in the overlay is not a detail. The shipped example
  # names a host path under the user's home, which is right there and wrong
  # here: the state directory is /config, so the persona and the skills are
  # deployed to /config/workspace, while the example's path resolves beside it
  # rather than into it. Nothing errors when it is wrong. The agent simply
  # comes up with no persona and no skill and answers like a stock assistant --
  # the hardest symptom here to trace back to a path.
  log "applying environment overlay (dmPolicy=$DM_POLICY)"
  if [ "$DRY_RUN" = yes ]; then
    log "would patch botToken, dmPolicy and the sender list from the environment"
  else
    # Empty in pairing mode, and deliberately so: an approved sender is
    # recorded in credentials/telegram-<account>-allowFrom.json, a different
    # file, which is what lets this overlay run on every boot without undoing
    # a pairing. The two lists do not merge, though -- `allowlist` ignores the
    # pairing store entirely -- so these are two paths, never two steps.
    senders=""
    approvals=""
    if [ -n "${TELEGRAM_ALLOW_FROM:-}" ]; then
      senders="\"$(json_escape "$TELEGRAM_ALLOW_FROM")\""
      approvals="
      execApprovals: { enabled: true, approvers: [$senders] },"
    fi

    printf '{
  // The gateway refuses to start without this and says so in a way that reads
  // as a damaged install: "existing config is missing gateway.mode. Treat this
  // as suspicious or clobbered config." The shipped example never carried it
  // because it was written to be patched onto a host that had already been
  // through `openclaw onboard`; in a container there is no already.
  // `.gateway-token` is the authority, restated here on every boot. The
  // gateway reads its token from the config while every CLI client -- the
  // provision service, `cron add`, a `docker compose exec` -- reads the file,
  // so the two silently diverging locks the clients out with
  // `token_mismatch`. Seen on the 2026.9.4 upgrade: `doctor --fix` invented a
  // token of its own for a config that had none, and provision could not
  // connect to the gateway it was meant to configure.
  gateway: { mode: "local", auth: { mode: "token", token: "%s" } },
  agents: { defaults: { workspace: "%s/workspace" } },
  // The dreaming sweep in memory-core defaults to on. It runs nightly in two
  // phases, consolidates memory out of the session corpora, and has a model
  // write a narrative diary entry into the workspace -- which means into the
  // system prompt of every turn after it, growing by an entry per phase per
  // night. Off here for two reasons that stand separately. It contradicts a
  // standing order the agent is given in the same prompt (no notes, no
  // session history; the register is the memory), and tools.allow is
  // exec/message/read, so the agent has no tool that can query the memory the
  // sweep builds: the nightly model run buys an archive nothing can reach and
  // delivers prose the deployment forbids.
  plugins: { entries: { "memory-core": { config: { dreaming: { enabled: false } } } } },
  channels: {
    telegram: {
      enabled: true,
      botToken: "%s",
      dmPolicy: "%s",
      allowFrom: [%s],%s
    },
  },
}\n' "$(json_escape "${OPENCLAW_GATEWAY_TOKEN:-}")" "$(json_escape "$STATE_DIR")" "$(json_escape "$TELEGRAM_BOT_TOKEN")" "$DM_POLICY" "$senders" "$approvals" \
      | "$OPENCLAW" config patch --stdin || die "openclaw config patch --stdin failed"
  fi

  # The exec allowlist. Seeded rather than replaced for the same reason as the
  # config: an installation may add a binary of its own. The shipped file has a
  # placeholder absolute path for a host install, which is meaningless here --
  # in the image `gamereg` is on PATH and the bare-name pattern is the one that
  # ever matched anyway.
  # Seeded through the CLI, not by copying the file into place. OpenClaw
  # 2026.9 moved the exec allowlist out of `$STATE_DIR/exec-approvals.json`
  # and into `state/openclaw.sqlite#exec_approvals_config`, and a legacy file
  # left sitting there is now fatal at *runtime* rather than at boot: the
  # gateway starts, and then every message fails with
  # `ExecApprovalsMigrationRequiredError`. Copying a file assumes a storage
  # format; `approvals set` asks the installed CLI to write whatever store it
  # currently has, which is the version-independent way to say the same thing.
  #
  # It needs a valid config, which is why repair_config_if_stale runs first.
  if [ ! -f "$STATE_DIR/.gamereg-approvals-seeded" ]; then
    log "seeding the exec allowlist"
    run "$OPENCLAW" approvals set --file "$DEFAULTS/exec-approvals.json" \
      || die "openclaw approvals set failed"
    run touch "$STATE_DIR/.gamereg-approvals-seeded"
  fi

  # A legacy file from an older image blocks the new store outright.
  if [ -f "$STATE_DIR/exec-approvals.json" ]; then
    log "removing the legacy exec-approvals.json (its contents now live in state/)"
    run rm -f "$STATE_DIR/exec-approvals.json"
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

  if [ "$DRY_RUN" = yes ]; then
    # `cron list` reaches a running gateway over the network, so it is not a
    # read this mode may make: --dry-run is documented as performing nothing,
    # and `provision --dry-run` is how the boot script is exercised in a test
    # where no gateway exists.
    log "would register cron job $name if absent"
    return 0
  fi

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
    repair_config_if_stale
    configure_git
    seed_vault
    resolve_gateway_token
    configure_model_auth
    configure_model
    configure_provider_retry
    deploy_agent_files
    configure_gateway
    [ "$DRY_RUN" = yes ] && { log "dry run complete, not starting the gateway"; exit 0; }
    log "starting the gateway"
    exec "$OPENCLAW" gateway run
    ;;
  provision)
    repair_config_if_stale
    resolve_gateway_token
    register_cron
    ;;
  site)
    [ "$DRY_RUN" = yes ] && { log "dry run complete, not starting the site loop"; exit 0; }
    exec /usr/local/bin/gamereg-site-loop
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
