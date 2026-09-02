# syntax=docker/dockerfile:1
#
# The Registrar, packaged: the CLI and the gateway in one image, at versions
# known to work together (06-roadmap.md, phase 4).
#
# One image serves two compose services -- the gateway and the maintenance
# loop -- because both need `gamereg` as a local binary. The agent's boundary
# (agent/workspace/AGENTS.md) is that it executes one allowlisted binary and
# nothing else; splitting the CLI into its own container would mean reaching it
# over a socket, which is a different boundary and a worse one.
#
# Debian, not Alpine. `sharp` publishes glibc prebuilds as optional deps, and
# the musl path is a second set of binaries to be surprised by. The ~60 MB
# saved is not worth an image whose image ingestion fails at runtime.

ARG NODE_VERSION=22-bookworm-slim

# --- build the tarball -------------------------------------------------------
#
# `npm pack` rather than copying `dist/` because it exercises the real
# packaging path: the `files` allowlist and the `prepare` hook are what a
# published package will use, and phase 4 owes that publish anyway. A bug in
# either shows up here rather than after `npm publish`.

FROM node:${NODE_VERSION} AS builder
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build && npm pack --ignore-scripts

# --- runtime -----------------------------------------------------------------

FROM node:${NODE_VERSION}

# Pinned on purpose. agent/README.md documents behaviour that is specific to a
# gateway version -- the dead `callback` branch on 2026.7.1-2 being the sharpest
# example -- so "the CLI and the gateway at versions known to work together" is
# the whole point of shipping an image rather than instructions.
ARG OPENCLAW_VERSION=2026.7.1-2

# git: the vault is a git repository and scripts/autobuild.sh commits and
# pushes it. openssh-client: that push needs a deploy key. tini: PID 1 that
# reaps, since the entrypoint execs a long-running Node process.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         ca-certificates git openssh-client tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/gamereg-*.tgz /tmp/
RUN npm install -g /tmp/gamereg-*.tgz "openclaw@${OPENCLAW_VERSION}" \
    && rm -f /tmp/gamereg-*.tgz \
    && gamereg --version

# The wrappers. checkin.sh is registered as an OpenClaw cron job by the
# entrypoint; autobuild.sh is what the maintenance service loops over.
COPY agent/checkin.sh /usr/local/bin/gamereg-checkin
COPY scripts/autobuild.sh /usr/local/bin/gamereg-autobuild
COPY docker/entrypoint.sh /usr/local/bin/gamereg-entrypoint
COPY docker/loop.sh /usr/local/bin/gamereg-loop
COPY docker/site-loop.sh /usr/local/bin/gamereg-site-loop
RUN chmod 0755 /usr/local/bin/gamereg-checkin /usr/local/bin/gamereg-autobuild \
                /usr/local/bin/gamereg-entrypoint /usr/local/bin/gamereg-loop \
                /usr/local/bin/gamereg-site-loop

# What the entrypoint deploys into the gateway's workspace. Skills are code and
# are replaced on every boot; workspace persona files are the user's and are
# seeded only when absent. Real directories, never symlinks -- OpenClaw's skill
# loader realpaths and refuses anything resolving outside its root.
COPY agent/skills /opt/gamereg/agent-defaults/skills
COPY agent/workspace /opt/gamereg/agent-defaults/workspace
COPY agent/openclaw.example.json5 /opt/gamereg/agent-defaults/openclaw.json5
COPY agent/approvals.example.json /opt/gamereg/agent-defaults/exec-approvals.json

# Both are read by the OpenClaw CLI and the gateway alike, which is what makes
# a single mounted directory hold every piece of gateway state: config, the
# workspace, the exec allowlist, the cron store and the session transcripts.
# HOME is not decoration here. The image declares `USER node` (uid 1000), but
# compose overrides it with the host's own uid so the bind-mounted vault is not
# owned by somebody else -- and when that uid is absent from /etc/passwd, Docker
# falls back to HOME=/, which is root-owned. `git config --global` then fails
# silently, and the first `git commit` aborts with "Please tell me who you are".
# Found on a host whose uid was 1001; it passes on any host whose uid is 1000,
# which is exactly the kind of coincidence a container is supposed to remove.
ENV HOME=/config \
    OPENCLAW_STATE_DIR=/config \
    OPENCLAW_CONFIG_PATH=/config/openclaw.json \
    GAMEREG_VAULT=/vault \
    GAMEREG_SOURCE=chat \
    GAMEREG_NON_INTERACTIVE=1

VOLUME ["/vault", "/config"]

# uid 1000 in the node image. Compose overrides this with the host's own uid so
# the bind-mounted vault does not end up owned by somebody else.
USER node

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/gamereg-entrypoint"]
CMD ["gateway"]
