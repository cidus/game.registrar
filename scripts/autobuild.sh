#!/bin/sh
#
# Vault maintenance: enrich, build, commit (CLAUDE.md, *Current state*).
#
# This used to be the agent's job -- SKILL.md had it fire `gamereg enrich`
# after every new game and `gamereg build` after every closed session, both
# silent and unreported. That spent a model turn deciding something that
# needs no deciding, was not reliable (a background `exec` call the agent
# could forget or narrate over), and never touched git at all. This script
# replaces both calls with a periodic, model-free sweep.
#
# It carries no state of its own -- git *is* the state. There is no offset
# file and no "settled" flag: a tick looks at whether the working tree is
# dirty, and if it is, catches it up and commits. That is also what makes a
# missed or overlapping tick harmless -- the next one just finds more to do.
#
# Order matters. `enrich` appends events to the log; `build` reads folded
# state and regenerates derived artifacts from it. Enrich has to run first so
# a build in the same tick already sees the metadata it fetched, and the
# commit at the end captures both in one shot.
#
# Two exit codes from the CLI are expected, not failures:
#   - `enrich --missing`: exit 6 (provider_unavailable) still commits whatever
#     local work enrich did before the network step failed -- see 02-cli.md.
#   - `build`: exit 5 (conflict) means another build holds the lock right
#     now. This is *not* queued: the tick ends with nothing committed, and
#     the next tick tries again against whatever the log holds by then.
#   - `build`: exit 1 (target_failed) means some targets wrote and one
#     didn't. What wrote is still on disk and still worth a commit.
#
# `--dry-run` prints the planned cycle to stderr and touches nothing -- no
# git status check, no gamereg call, no git call.

set -u

DRY_RUN=no
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=yes ;;
    *) echo "autobuild.sh: usage: autobuild.sh [--dry-run]" >&2; exit 2 ;;
  esac
  shift
done

GAMEREG=${GAMEREG_BIN:-gamereg}
GIT=${GIT_BIN:-git}

# The vault is wherever the environment says it is (invariant 15); nothing
# here is coupled to an install path. A systemd unit sets this declaratively
# (Environment=GAMEREG_VAULT=...); an unset value is a misconfiguration to
# fail on, never a directory to guess at.
if [ -z "${GAMEREG_VAULT:-}" ]; then
  echo "autobuild.sh: GAMEREG_VAULT is not set; nothing to maintain." >&2
  exit 2
fi
export GAMEREG_VAULT

# Both set here, not inherited -- a systemd unit's environment has no reason
# to carry GAMEREG_SOURCE=chat, but nothing should depend on that being true
# forever. `cron` is a real EVENT_SOURCE for exactly this.
GAMEREG_SOURCE=cron
GAMEREG_NON_INTERACTIVE=1
export GAMEREG_SOURCE GAMEREG_NON_INTERACTIVE

if [ "$DRY_RUN" = yes ]; then
  echo "--- would run, in the vault at $GAMEREG_VAULT ---" >&2
  echo "$GAMEREG enrich --missing --covers --json" >&2
  echo "$GAMEREG build --json" >&2
  echo "--- then stage data/events.jsonl, assets/ and every path build plans to own" >&2
  echo "    (or just removed), commit if anything is staged, and push if a remote" >&2
  echo "    is configured ---" >&2
  exit 0
fi

if ! cd "$GAMEREG_VAULT" 2>/dev/null; then
  echo "autobuild.sh: cannot cd into GAMEREG_VAULT: $GAMEREG_VAULT" >&2
  exit 2
fi

work=$(mktemp -d) || exit 1
trap 'rm -rf "$work"' EXIT INT TERM

status=0

# 1. A clean tree means nothing has happened since the last commit -- no new
#    event, nothing left over from a tick that enriched or built but never
#    got to commit. A tick that finds this costs nothing: no network call, no
#    build, no git call beyond this one.
#
# `.gamereg/` is excluded on purpose: it holds the build lock and the
# ownership manifest, gamereg's own bookkeeping rather than vault content, and
# it is untracked on every vault by construction -- without the exclusion no
# tree is ever clean and every tick pays for a network call and a build for
# nothing.
dirty=$("$GIT" status --porcelain -- . ':!.gamereg' 2>&1)
git_status_code=$?
if [ "$git_status_code" -ne 0 ]; then
  echo "autobuild.sh: git status failed: $dirty" >&2
  exit 1
fi
[ -n "$dirty" ] || exit 0

# 2. Metadata first, so a build in this same tick already sees it.
"$GAMEREG" enrich --missing --covers --json >/dev/null 2>"$work/enrich.err"
enrich_code=$?
if [ "$enrich_code" -ne 0 ] && [ "$enrich_code" -ne 6 ]; then
  echo "autobuild.sh: gamereg enrich --missing failed: $(cat "$work/enrich.err")" >&2
  status=1
fi

# 3. Regenerate derived artifacts.
build_code=0
build_out=$("$GAMEREG" build --json 2>"$work/build.err") || build_code=$?
if [ "$build_code" -eq 5 ]; then
  # Another build holds the lock. Not this tick's failure -- and nothing here
  # is worth committing yet, since build wrote nothing this time.
  exit "$status"
elif [ "$build_code" -ne 0 ] && [ "$build_code" -ne 1 ]; then
  echo "autobuild.sh: gamereg build failed: $(cat "$work/build.err")" >&2
  exit 1
elif [ "$build_code" -eq 1 ]; then
  # target_failed: some targets wrote, one didn't. What wrote is still
  # committed -- see the file header.
  status=1
fi

# 4. Stage every path this build owns right now, plus whatever it just
#    removed -- not only `written`/`removed`, which name only what changed on
#    *this* tick and say nothing about a file that already had the right
#    bytes on disk from a build run outside this script (by hand, or by an
#    earlier tick that built but was never given the chance to commit). Build
#    is idempotent by design (invariant 2) -- a no-op rewrite is not evidence
#    there is nothing to stage, only that the working tree already agreed
#    with the plan. `planned` is every path the build declares, written or
#    not, which is what makes this correct regardless of how the file got
#    there. Still never a blind `git add -A`: this stays scoped to what
#    gamereg itself could ever own, plus the log and the asset store enrich's
#    cover fetch writes into directly.
paths=$(printf '%s' "$build_out" | node -e '
  let raw = ""
  process.stdin.on("data", (chunk) => { raw += chunk })
  process.stdin.on("end", () => {
    let result
    try { result = JSON.parse(raw).result } catch { result = null }
    const planned = (result?.planned ?? []).map((entry) => entry.path)
    const removed = result?.removed ?? []
    process.stdout.write([...planned, ...removed].join("\n"))
  })
' 2>"$work/paths.err")

if [ -n "$paths" ]; then
  echo "$paths" | while IFS= read -r path; do
    [ -n "$path" ] || continue
    "$GIT" add -- "$path" >/dev/null 2>&1
  done
fi
"$GIT" add -- data/events.jsonl >/dev/null 2>&1
"$GIT" add -- assets >/dev/null 2>&1

# `targets/mirror.ts` hardlinks assets into `obsidian/assets` and
# `quartz/content/assets` as an add-only pass *outside* the manifest --
# "not a planned file" is the whole point (CLAUDE.md: it stays clear of
# invariant 9 precisely because nothing here deletes it), which also means it
# never appears in build's `planned` array above. Left out, a freshly
# ingested photo's mirrored copy sits untracked forever, even though the
# original under `assets/` gets staged fine. Both are harmless no-ops when
# the target that mirrors into them is disabled or has never run.
"$GIT" add -- obsidian/assets >/dev/null 2>&1
"$GIT" add -- quartz/content/assets >/dev/null 2>&1

if "$GIT" diff --cached --quiet 2>/dev/null; then
  exit "$status"
fi

committed=$("$GIT" commit -m 'chore(vault): automated enrich and build' 2>&1)
commit_code=$?
if [ "$commit_code" -ne 0 ]; then
  echo "autobuild.sh: git commit failed: $committed" >&2
  exit 1
fi

# Push only when a remote is configured -- a no-op until one is, rather than
# an error every tick for a vault that has never been given one. Pushed by
# explicit remote and branch name, not bare `git push`, so a freshly
# `git remote add`-ed vault with no upstream tracking set up yet still works
# with no prompt and no one-time manual `--set-upstream`.
remote=$("$GIT" remote 2>/dev/null | head -n 1)
if [ -n "$remote" ]; then
  branch=$("$GIT" symbolic-ref --short HEAD 2>/dev/null)
  pushed=$("$GIT" push "$remote" "$branch" 2>&1)
  push_code=$?
  if [ "$push_code" -ne 0 ]; then
    echo "autobuild.sh: git push failed: $pushed" >&2
    status=1
  fi
fi

exit "$status"
