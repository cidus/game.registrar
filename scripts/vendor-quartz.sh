#!/bin/sh
#
# Vendors a Quartz checkout's framework files into <vault>/quartz/, leaving
# the vault's own content/ and quartz.config.yaml untouched (CLAUDE.md,
# *Current state* — the manual procedure this script replaces). Rerunnable:
# a second run updates the framework in place, which is what makes this also
# an upgrade path, not just a one-time setup.
#
# This is one verified path for getting a Quartz site built, not the
# answer to "how does deployment work" — that question is still deliberately
# open for phase 5 (CLAUDE.md, *Open items*), because deciding it once here
# and again in phase 5 is how the two answers end up disagreeing.
#
# What gets copied is an explicit allowlist, not "everything except a few
# names": a real Quartz checkout also carries .github/ (the upstream
# project's own CI workflows -- these must never land in a vault's repo,
# which could pick them up and run them), docs/, Dockerfile,
# CODE_OF_CONDUCT.md, README.md -- none of that is the framework. The list
# below is the layout verified against Quartz 5.0.0; a future restructuring
# upstream may need it extended.
#
# The `quartz/` entry (the framework's own source subdirectory) is replaced
# wholesale -- removed, then copied fresh -- on every run, not merged, so a
# file Quartz removed upstream does not linger here after an update. Every
# other allowlisted entry is a single file, overwritten in place -- except
# package.json, which is merged rather than replaced.
#
# **`FRAMEWORK_PRESERVE` lists paths inside that same subdirectory Quartz
# itself designates for site-specific customization, not framework code --
# `quartz/styles/custom.scss` is Quartz's own documented place for
# site-specific CSS.** The wholesale replace above would otherwise wipe a
# hand-written one on every rerun, exactly like the package.json problem
# but for an opaque file with no merge to speak of: whatever the destination
# already has at each of these paths is backed up first and restored after,
# so the checkout's own version of that file is fetched and then discarded
# unused. This is narrower than Quartz's own `quartz upgrade` (a real `git
# pull --rebase`, reconciling arbitrary in-tree edits): a fixed, short list
# rather than every file, so a customization made anywhere else in the tree
# does not survive a rerun -- extend this list by hand if that happens.
#
# **package.json is merged, package-lock.json is regenerated, never copied.**
# A vault's quartz.config.yaml can name a theme (or any other Quartz plugin)
# that the checkout's package.json has no dependency entry for at all -- this
# happened for real, the first time this script ran against a live vault:
# quartz.config.yaml already selected the "geocities-98" theme, the fix was
# `npm install @quartz-themes/geocities-98` run inside the vault, and the
# next vendor blindly overwrote that fix straight back out by copying the
# checkout's package.json verbatim. So package.json is merged instead: take
# the checkout's as the base (framework dependency bumps flow through), then
# add back any `dependencies`/`devDependencies` entry the destination
# already had that the checkout's does not -- a site-specific theme survives
# an update. package-lock.json is never copied at all; `npm install` (not
# `npm ci`) regenerates it against the merged package.json, which is the
# only way the added theme's own lock entry gets resolved.
#
# --source and --clone are the two ways to get a checkout to vendor from --
# exactly one is required. --clone fetches the upstream repository fresh into
# a throwaway temp directory (shallow, `--depth 1`) and uses that as the
# checkout; --tag pins it to a specific ref (a released tag, most often) and
# only makes sense alongside --clone -- pinning a directory the caller
# already checked out themselves (--source) is the caller's business, not
# this script's. With no --tag, --clone tracks the upstream default branch,
# i.e. latest. Running this again later with --clone (--tag or not) is the
# upgrade path; --source stays for anyone who already keeps their own
# checkout, the way this script's first live run did.
#
# --dry-run prints the plan and touches nothing: no clone, no copy, no npm,
# no npx.

set -u

QUARTZ_REPO_URL="https://github.com/jackyzha0/quartz"

SOURCE=
CLONE=no
TAG=
DRY_RUN=no
while [ $# -gt 0 ]; do
  case "$1" in
    --source)
      SOURCE=${2:-}
      if [ -z "$SOURCE" ]; then
        echo "vendor-quartz.sh: --source needs a path" >&2
        exit 2
      fi
      shift 2
      ;;
    --clone) CLONE=yes; shift ;;
    --tag)
      TAG=${2:-}
      if [ -z "$TAG" ]; then
        echo "vendor-quartz.sh: --tag needs a value" >&2
        exit 2
      fi
      shift 2
      ;;
    --dry-run) DRY_RUN=yes; shift ;;
    *)
      echo "vendor-quartz.sh: usage: vendor-quartz.sh (--source <path> | --clone [--tag <ref>]) [--dry-run]" >&2
      exit 2
      ;;
  esac
done

if [ -n "$SOURCE" ] && [ "$CLONE" = yes ]; then
  echo "vendor-quartz.sh: --source and --clone are mutually exclusive" >&2
  exit 2
fi
if [ -z "$SOURCE" ] && [ "$CLONE" = no ]; then
  echo "vendor-quartz.sh: one of --source <path> or --clone is required" >&2
  exit 2
fi
if [ -n "$TAG" ] && [ "$CLONE" = no ]; then
  echo "vendor-quartz.sh: --tag only makes sense with --clone" >&2
  exit 2
fi

GIT=${GIT_BIN:-git}
NPM=${NPM_BIN:-npm}
NPX=${NPX_BIN:-npx}

# One trap for every throwaway temp dir this script creates (the clone
# target, the customization-point backup) -- a second `trap ... EXIT` call
# would replace the first, not add to it, so every temp dir this script ever
# makes is tracked here instead of setting its own trap.
CLEANUP_DIRS=""
cleanup() {
  for d in $CLEANUP_DIRS; do
    rm -rf "$d"
  done
}
trap cleanup EXIT INT TERM

# The vault is wherever the environment says it is (invariant 15), same as
# every other script here -- unset is a misconfiguration, never a guess.
if [ -z "${GAMEREG_VAULT:-}" ]; then
  echo "vendor-quartz.sh: GAMEREG_VAULT is not set; nothing to vendor into." >&2
  exit 2
fi

DEST="$GAMEREG_VAULT/quartz"

# gamereg seeds content/ and quartz.config.yaml when the `quartz` target
# builds (docs/spec/07-targets.md); vendoring before that has happened would
# lay framework files over an empty quartz/ with nothing yet to preserve, and
# no seeded config for the build below to read. Checked before cloning
# anything -- no reason to fetch a repository just to fail on this.
if [ ! -f "$DEST/quartz.config.yaml" ]; then
  echo "vendor-quartz.sh: $DEST/quartz.config.yaml does not exist." >&2
  echo "vendor-quartz.sh: run 'gamereg build quartz' in the vault first — it seeds" >&2
  echo "vendor-quartz.sh: quartz.config.yaml and content/, which this script never touches." >&2
  exit 2
fi

# The verified Quartz 5.0.0 top-level layout, minus content/ and
# quartz.config.yaml (the vault's own) and minus everything that is not the
# framework (.git, .github, node_modules, public, .quartz, docs, Dockerfile,
# CODE_OF_CONDUCT.md, README.md). package.json is handled separately, below —
# merged, not copied verbatim — and package-lock.json is never copied at all.
FILES="
.gitattributes
.gitignore
.node-version
.npmrc
.prettierignore
.prettierrc
LICENSE.txt
globals.d.ts
index.d.ts
tsconfig.json
quartz.ts
quartz.config.default.yaml
"

# Paths inside the framework's own quartz/ subdirectory, relative to it, that
# survive the wholesale replace below even though everything else in that
# subdirectory doesn't -- see the comment on FRAMEWORK_PRESERVE above.
FRAMEWORK_PRESERVE="
styles/custom.scss
"

if [ "$DRY_RUN" = yes ]; then
  if [ "$CLONE" = yes ]; then
    echo "--- would clone $QUARTZ_REPO_URL${TAG:+ @ $TAG} into a temp dir ---" >&2
  else
    if [ ! -d "$SOURCE" ]; then
      echo "vendor-quartz.sh: --source is not a directory: $SOURCE" >&2
      exit 2
    fi
    if [ ! -f "$SOURCE/package.json" ] || ! grep -q '"name": *"@jackyzha0/quartz"' "$SOURCE/package.json" 2>/dev/null; then
      echo "vendor-quartz.sh: $SOURCE does not look like a Quartz checkout (no @jackyzha0/quartz package.json)" >&2
      exit 2
    fi
    echo "--- would vendor from $SOURCE into $DEST ---" >&2
  fi
  for f in $FILES; do
    echo "  copy $f" >&2
  done
  echo "  replace quartz/ (framework source) wholesale, except:" >&2
  for p in $FRAMEWORK_PRESERVE; do
    echo "    $p (customization point, never overwritten)" >&2
  done
  echo "  merge package.json (destination-only dependencies survive)" >&2
  echo "--- then: $NPM install; $NPX quartz build; seed wrangler.jsonc if absent ---" >&2
  exit 0
fi

if [ "$CLONE" = yes ]; then
  CLONE_DIR=$(mktemp -d) || exit 1
  CLEANUP_DIRS="$CLEANUP_DIRS $CLONE_DIR"
  clone_target="$CLONE_DIR/quartz"
  echo "vendor-quartz.sh: cloning $QUARTZ_REPO_URL${TAG:+ @ $TAG}"
  if [ -n "$TAG" ]; then
    "$GIT" clone --depth 1 --branch "$TAG" "$QUARTZ_REPO_URL" "$clone_target"
  else
    "$GIT" clone --depth 1 "$QUARTZ_REPO_URL" "$clone_target"
  fi || {
    echo "vendor-quartz.sh: git clone failed" >&2
    exit 1
  }
  SOURCE="$clone_target"
fi

if [ ! -d "$SOURCE" ]; then
  echo "vendor-quartz.sh: --source is not a directory: $SOURCE" >&2
  exit 2
fi
if [ ! -f "$SOURCE/package.json" ] || ! grep -q '"name": *"@jackyzha0/quartz"' "$SOURCE/package.json" 2>/dev/null; then
  echo "vendor-quartz.sh: $SOURCE does not look like a Quartz checkout (no @jackyzha0/quartz package.json)" >&2
  exit 2
fi

echo "vendor-quartz.sh: vendoring from $SOURCE into $DEST"

for f in $FILES; do
  if [ ! -e "$SOURCE/$f" ]; then
    continue
  fi
  cp "$SOURCE/$f" "$DEST/$f" || {
    echo "vendor-quartz.sh: failed to copy $f" >&2
    exit 1
  }
  echo "  copied $f"
done

if [ -d "$SOURCE/quartz" ]; then
  backup_dir=$(mktemp -d) || exit 1
  CLEANUP_DIRS="$CLEANUP_DIRS $backup_dir"
  for p in $FRAMEWORK_PRESERVE; do
    if [ -f "$DEST/quartz/$p" ]; then
      mkdir -p "$backup_dir/$(dirname "$p")"
      cp "$DEST/quartz/$p" "$backup_dir/$p"
    fi
  done

  rm -rf "$DEST/quartz"
  cp -r "$SOURCE/quartz" "$DEST/quartz" || {
    echo "vendor-quartz.sh: failed to copy quartz/ (framework source)" >&2
    exit 1
  }
  echo "  copied quartz/ (framework source, replaced wholesale)"

  for p in $FRAMEWORK_PRESERVE; do
    if [ -f "$backup_dir/$p" ]; then
      mkdir -p "$(dirname "$DEST/quartz/$p")"
      cp "$backup_dir/$p" "$DEST/quartz/$p"
      echo "  restored quartz/$p (customization point, never overwritten)"
    fi
  done
fi

node -e '
  const fs = require("node:fs")
  const [srcPath, destPath] = process.argv.slice(1)
  const src = JSON.parse(fs.readFileSync(srcPath, "utf8"))
  let dest = {}
  try { dest = JSON.parse(fs.readFileSync(destPath, "utf8")) } catch { /* first vendor, nothing to preserve */ }
  const merged = { ...src }
  for (const key of ["dependencies", "devDependencies"]) {
    const srcDeps = src[key] ?? {}
    const destOnly = Object.fromEntries(
      Object.entries(dest[key] ?? {}).filter(([name]) => !(name in srcDeps)),
    )
    if (Object.keys(destOnly).length > 0) merged[key] = { ...srcDeps, ...destOnly }
  }
  fs.writeFileSync(destPath, JSON.stringify(merged, null, 2) + "\n")
' "$SOURCE/package.json" "$DEST/package.json" || {
  echo "vendor-quartz.sh: failed to merge package.json" >&2
  exit 1
}
echo "  merged package.json"

rm -f "$DEST/package-lock.json"

echo "vendor-quartz.sh: running npm install"
if ! ( cd "$DEST" && "$NPM" install ); then
  echo "vendor-quartz.sh: npm install failed" >&2
  exit 1
fi

echo "vendor-quartz.sh: running npx quartz build to verify"
if ! ( cd "$DEST" && "$NPX" quartz build ); then
  echo "vendor-quartz.sh: quartz build failed — see its own error above" >&2
  exit 1
fi

# Seed, never overwritten — the same policy templates/quartz.config.yaml
# already uses in gamereg itself (docs/spec/07-targets.md), applied here
# because this file may have been hand-edited since (a custom domain route,
# for instance).
#
# `name` is a guess and nothing here can make it better: it has to equal the
# Worker you actually created, and this script has no way to know that. The
# guess used to append "-site" to the vault's directory name, which produced
# `gamereg-vault-site` against a Worker called `gamereg-vault` -- wrong from
# the moment it was first written, and never noticed, because Cloudflare's own
# dashboard builds know which Worker they are building and only warn about the
# mismatch. What it does break is a manual `wrangler deploy`, which reads this
# file and would target a Worker that does not exist.
#
# So the suffix is gone, and the guess says out loud that it is one.
if [ ! -f "$DEST/wrangler.jsonc" ]; then
  name=$(basename "$GAMEREG_VAULT")
  today=$(date +%Y-%m-%d)
  cat > "$DEST/wrangler.jsonc" <<EOF
{
	// GUESS: this must match the Worker's own name, and nothing that wrote
	// this file knew it. Check it against the dashboard before deploying by
	// hand -- \`wrangler deploy\` reads this and will happily target a Worker
	// that does not exist.
	"name": "$name",
	// Bump this if you ever touch this file again; otherwise leave it be —
	// it only affects which Workers runtime behaviors apply, not the build.
	"compatibility_date": "$today",
	"assets": {
		"directory": "./public"
	}
}
EOF
  echo "  seeded wrangler.jsonc (name: $name — a guess; check it against the Worker)"
else
  echo "  wrangler.jsonc already exists, left alone"
fi

echo "vendor-quartz.sh: done"
