#!/bin/sh
#
# The maintenance interval, in a container.
#
# On a host this is scripts/gamereg-autobuild.timer, and systemd guarantees two
# things a shell loop does not get for free: it will not start a second run of
# a Type=oneshot service while one is active, and it staggers. Neither is
# actually needed here.
#
# Overlap is already impossible to make harmful: `gamereg build` holds a
# lockfile and exits 5 rather than queueing, and autobuild.sh treats a dirty
# working tree as its only state -- a tick that finds nothing does nothing, and
# a tick that overlaps just finds the work already done. Staggering matters for
# a fleet; there is one of these.
#
# So the loop is a loop, and the interesting decisions are the two below.

set -u

INTERVAL="${GAMEREG_AUTOBUILD_INTERVAL:-600}"
AUTOBUILD="${GAMEREG_AUTOBUILD_BIN:-/usr/local/bin/gamereg-autobuild}"

log() { echo "loop: $*" >&2; }

# A tick's failure is never the loop's failure. autobuild.sh already treats
# exit 5 (another build holds the lock) and exit 6 (the provider was
# unreachable) as ordinary outcomes, and the ones it does report are transient
# by nature: a network that was down, a remote that rejected a push. Exiting
# would hand the problem to the restart policy, which would retry on its own
# schedule rather than this one, and would lose the log line explaining why.
log "maintenance loop starting, every ${INTERVAL}s"

while true; do
  "$AUTOBUILD" || log "tick exited $? -- continuing"

  # Sleep in the background and wait on it, rather than sleeping directly, so
  # that SIGTERM from `docker compose stop` is handled between ticks instead of
  # after the full interval. A plain `sleep` in a shell script is not
  # interruptible while the shell is not waiting.
  sleep "$INTERVAL" &
  wait $!
done
