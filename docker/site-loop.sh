#!/bin/sh
#
# Build the Quartz site whenever the vault's content changes.
#
# Off by default, and on a 1 GB machine it should stay off -- see
# docs/deploy-container.md. It exists for two reasons: an installation that
# does not want a Cloudflare or GitHub account still needs a page, and the
# shape is the one a future Astro target will reuse unchanged (something
# builds, something static serves).
#
# There is no upstream image to use. Quartz's own Dockerfile runs
# `npx quartz build --serve`, which is a development server with no EXPOSE and
# no production story, and ghcr.io/jackyzha0/quartz:hugo is the abandoned v3
# line. So this is a plain node image plus this loop.
#
# The trigger is the vault's git HEAD rather than a filesystem watch. gamereg
# rebuilds derived artifacts wholesale on every `build`, so mtimes move
# constantly and say nothing about whether the *content* changed; a commit
# means autobuild.sh found a real difference and recorded it. It is also the
# one signal that survives a restart, since it is read from the repository
# rather than held in memory.
#
# What this deliberately does not do is ask Docker to run anything. Triggering
# a build from the maintenance container would mean mounting the Docker socket
# into a container that shares a network with a language model holding a shell.

set -u

VAULT="${GAMEREG_VAULT:-/vault}"
QUARTZ="$VAULT/quartz"
OUTPUT="${GAMEREG_SITE_OUTPUT:-/site}"
INTERVAL="${GAMEREG_SITE_INTERVAL:-300}"
GIT="${GIT_BIN:-git}"
NPM="${NPM_BIN:-npm}"
NPX="${NPX_BIN:-npx}"
STAMP="$OUTPUT/.built-from"

log() { echo "site: $*" >&2; }

# `gamereg build quartz` writes content and a seeded config; the framework
# itself is vendored by scripts/vendor-quartz.sh, which is a separate,
# deliberate step because it clones a third-party repository. Refusing here
# rather than half-building is what keeps the two from being confused.
if [ ! -f "$QUARTZ/quartz.config.yaml" ]; then
  log "no $QUARTZ/quartz.config.yaml -- run 'gamereg build quartz' first"
  exit 2
fi
if [ ! -f "$QUARTZ/package.json" ]; then
  log "$QUARTZ holds no Quartz checkout -- run scripts/vendor-quartz.sh first"
  exit 2
fi

log "watching $VAULT for commits, every ${INTERVAL}s"

while true; do
  head="$("$GIT" -C "$VAULT" rev-parse HEAD 2>/dev/null || echo none)"
  built="$(cat "$STAMP" 2>/dev/null || echo none)"

  if [ "$head" != "$built" ]; then
    log "vault at $head, site built from $built -- rebuilding"

    # Only when it is missing. `npm install` is the single most expensive thing
    # that happens on this machine, and on a burstable instance it drains the
    # CPU credit that everything else is sharing.
    if [ ! -d "$QUARTZ/node_modules" ]; then
      log "installing Quartz dependencies (slow, once)"
      (cd "$QUARTZ" && "$NPM" install --no-audit --no-fund) || { log "npm install failed"; sleep "$INTERVAL"; continue; }
    fi

    if (cd "$QUARTZ" && "$NPX" quartz build --output "$OUTPUT"); then
      echo "$head" > "$STAMP"
      log "built"
    else
      # Leave the stamp alone so the next tick retries, and leave whatever was
      # served before in place: a stale page beats a blank one.
      log "quartz build failed -- keeping the previous site"
    fi
  fi

  sleep "$INTERVAL" &
  wait $!
done
