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
#
# And it never writes to the vault. `npm install` and `quartz build` between
# them run whatever a third-party plugin declared -- `quartz plugin add` takes
# a GitHub URL and clones it -- and the vault is the append-only event log plus
# the git tree whose dirty state is autobuild.sh's entire notion of state. So
# the tree is copied into a scratch directory under the cache mount and built
# there, which is what lets compose mount /vault read-only for this service.
# The copy is not a performance cost worth avoiding: it is a few megabytes of
# Markdown, against an npm install measured at 14 seconds.

set -u

VAULT="${GAMEREG_VAULT:-/vault}"
QUARTZ="$VAULT/quartz"
# Where the build actually happens. Under the cache mount, so node_modules and
# the plugins Quartz clones survive a restart the way they did when the build
# ran in the vault.
WORK="${GAMEREG_SITE_WORK:-/cache/quartz-build}"
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

# The serving configuration is written here, into the directory that is already
# shared with the server, because the alternative is mounting a file from the
# compose project directory -- and that only ever works in a checkout. On a
# machine holding compose.yml and .env, Docker creates a directory at the
# missing path and the server dies on "are you trying to mount a directory onto
# a file". Same trap as the loop script itself, one service over.
write_caddyfile() {
  # Comments served under the site's own origin, when they run on this machine
  # too. `handle_path` strips the prefix before proxying, which is exactly what
  # Remark42 behind a subpath needs -- its documented nginx recipe is
  # `rewrite /remark42/(.*) /$1 break`, and this is Caddy's equivalent.
  #
  # What this buys: one published port instead of two, no CORS allowlist to keep
  # in step with the site's address, and a `REMARK_URL` that is just the site's
  # own. Verified through the proxy -- config, auth status, thread reads and the
  # web assets all answer 200 under the prefix.
  #
  # `REMARK_URL` has to carry the path to match: http://host:8080/remark42. It
  # is the one pairing that fails silently, together with the plugin's `host`.
  #
  # Remark42's tracker carries a subpath defect where OAuth sign-in links lose
  # the prefix (umputun/remark42#961). It did not reproduce here: a real GitHub
  # login completed through this proxy, comment posted, on v1.16.4. Keep the
  # pointer anyway -- if a sign-in link ever comes back without /remark42, that
  # is the bug, and the escape is to publish Remark42 on its own port and leave
  # SITE_COMMENTS_UPSTREAM empty.
  comments=""
  if [ -n "${SITE_COMMENTS_UPSTREAM:-}" ]; then
    comments="
	handle_path /remark42/* {
		reverse_proxy ${SITE_COMMENTS_UPSTREAM}
	}
"
    log "serving comments under /remark42/ from $SITE_COMMENTS_UPSTREAM"
  fi

  cat > "$OUTPUT/Caddyfile" <<CADDY
:8080 {
	root * /site
	# The .html candidate first, deliberately. Quartz emits both a
	# tags/gamereg.html file and a tags/gamereg/ directory, so matching the
	# bare path finds the directory, which has no index, and 404s a page that
	# is sitting right there. And without try_files at all, every internal
	# link 404s while the front page works, because Quartz links to /stats and
	# emits stats.html.
	try_files {path}.html {path}/index.html {path}
	file_server
	encode gzip
${comments}
	# Not part of the site.
	@config path /Caddyfile
	respond @config 404
}
CADDY
}

# Copies the vault's Quartz tree into the scratch directory, replacing what was
# there. Everything the build generates is kept: node_modules because
# reinstalling it every commit would cost 14 seconds for nothing, .quartz
# because that is where `quartz plugin add` puts the plugins it cloned, and
# public because Quartz owns it and removes it itself.
#
# Replacing rather than overlaying matters. A file deleted in the vault -- a
# game revoked, a run note renamed -- has to disappear from the build too, and
# copying on top of a previous tree would leave the site publishing a page for
# something no longer in the register.
refresh_work() {
  mkdir -p "$WORK" || return 1
  find "$WORK" -mindepth 1 -maxdepth 1 \
    ! -name node_modules ! -name .quartz ! -name public \
    -exec rm -rf {} + || return 1
  tar -C "$QUARTZ" -cf - \
      --exclude=./node_modules --exclude=./.quartz --exclude=./public --exclude=./.git . \
    | tar -C "$WORK" -xf -
}

write_caddyfile
log "watching $VAULT for commits, every ${INTERVAL}s (building in $WORK)"

while true; do
  head="$("$GIT" -C "$VAULT" rev-parse HEAD 2>/dev/null || echo none)"
  built="$(cat "$STAMP" 2>/dev/null || echo none)"

  if [ "$head" != "$built" ]; then
    log "vault at $head, site built from $built -- rebuilding"

    if ! refresh_work; then
      log "could not stage $QUARTZ into $WORK"
      sleep "$INTERVAL" &
      wait $!
      continue
    fi

    # Guarded by a sentinel written *after* a successful install, not by the
    # directory's existence. An install killed partway leaves node_modules
    # there and incomplete, and `npm install` over a corrupt tree does not
    # reliably repair it -- the symptom is a build failing on a missing
    # transitive dependency, forever, while the directory the check looks for
    # sits right there. Seen exactly that, twice, on a machine slow enough to
    # interrupt.
    #
    # The sentinel records which lockfile it was written for, so vendoring a
    # new Quartz reinstalls instead of building against the old tree.
    lock="$(cksum "$WORK/package-lock.json" 2>/dev/null || echo none)"
    if [ "$(cat "$WORK/node_modules/.gamereg-install-ok" 2>/dev/null || true)" != "$lock" ]; then
      log "installing Quartz dependencies"
      rm -rf "$WORK/node_modules"
      if (cd "$WORK" && "$NPM" install --no-audit --no-fund); then
        echo "$lock" > "$WORK/node_modules/.gamereg-install-ok"
      else
        log "npm install failed"
        sleep "$INTERVAL"
        continue
      fi
    fi

    # Quartz is left to write into its own ./public, and the result is copied
    # out. Pointing --output at the mount fails with "EACCES: permission
    # denied, rmdir" -- Quartz removes and recreates its output directory, and
    # a bind mount point cannot be removed by anyone. Building into a directory
    # Quartz owns sidesteps the argument entirely.
    if (cd "$WORK" && "$NPX" quartz build); then
      # Contents, never the directory itself, for the same reason. The site is
      # briefly incomplete while this runs; at a megabyte or two that window is
      # shorter than the poll interval by four orders of magnitude.
      find "$OUTPUT" -mindepth 1 -delete 2>/dev/null
      cp -a "$WORK/public/." "$OUTPUT/" && write_caddyfile && echo "$head" > "$STAMP" && log "built"
    else
      # Leave the stamp alone so the next tick retries, and leave whatever was
      # served before in place: a stale page beats a blank one.
      log "quartz build failed -- keeping the previous site"
    fi
  fi

  sleep "$INTERVAL" &
  wait $!
done
