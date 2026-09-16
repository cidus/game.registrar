# 0062. Vault maintenance is a periodic external script

- **Status:** Accepted
- **Date:** 2026-08-26
- **Area:** Container deployment

## Context

SKILL.md had the agent fire `gamereg enrich` and `gamereg build` as backgrounded, unreported exec calls, and ignore non-zero exits. build's lockfile exits 5 immediately rather than queuing, so two session closes near each other silently lost the second build. The alternative considered was teaching enrich and build to fork and return immediately instead of relying on the exec tool's background param.

enrich and build used to run as backgrounded, unreported exec calls from SKILL.md. Two session closes close together silently lost a build: the build lockfile exits 5 instead of queuing, and SKILL.md said to ignore non-zero exits. `enrich --missing` made an external sweep cheap.

The agent used to fire `enrich` and `build` as backgrounded, unreported exec calls. `build` started while another holds the lock exits 5 immediately instead of queuing, so two session closes near each other silently lost the second build, and SKILL.md said to ignore non-zero exits. A self-backgrounding flag on gamereg was considered and rejected under invariant 5: `enrich` is the only network command and stays synchronous so a caller has one observable success point.

## Decision

Rejected against invariant 5: enrich is kept the one command that reaches the network, synchronous and separate, so a caller (test, script, person reading the exit code) has one observable point where success is knowable. A self-backgrounding enrich returns before that point exists, the same failure as the old 'ignore non-zero exit' rule moved into the binary. Instead, scripts/autobuild.sh polls `git status` in the vault and, when dirty, runs `enrich --missing --covers`, then `build`, then commits and pushes. Every gamereg call inside it is synchronous; only the script itself runs periodically (systemd --user timer on a host, docker/loop.sh in the container).

A periodic external script (systemd --user timer on a host; docker/loop.sh in the container) polls `git status`; when dirty it runs `enrich --missing --covers`, then build, commit and push. It keeps no state beyond the repo, and every gamereg call is synchronous. A self-backgrounding CLI flag was rejected (invariant 5).

`scripts/autobuild.sh` checks `git status` in the vault. When dirty, it runs `enrich --missing --covers`, then `build`, then commits and pushes. It keeps no state beyond the repository, so a missed or overlapping tick just finds more to do. It is timed by a systemd --user timer on a host and by docker/loop.sh in the container. The agent runs `gamereg build` only when the user asks in the moment.

## Consequences

The agent runs build only when the user asks. The tools.exec.notifyOnExit risk (a finishing background call enqueuing a heartbeat that wakes the agent to comment unprompted) was not fixed; it stopped applying, with no config change. Git status is the only state, so a freshly seeded vault must be committed or every tick enriches again.

Maintenance is eventually consistent, one tick later. The agent runs build only on explicit request. The notifyOnExit wake risk stopped applying. Do not add an async flag to enrich or build.

Derived output lags by one timer interval (GAMEREG_AUTOBUILD_INTERVAL, 600s default). Every gamereg call inside the script stays synchronous; only the script is backgrounded. With no background exec calls left, `tools.exec.notifyOnExit` no longer needs watching. Do not add an async or fork flag to enrich/build.

## Related

- [scripts/autobuild.sh](../../scripts/autobuild.sh)
- [scripts/gamereg-autobuild.service](../../scripts/gamereg-autobuild.service)
- [scripts/gamereg-autobuild.timer](../../scripts/gamereg-autobuild.timer)
- [docker/loop.sh](../../docker/loop.sh)
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [src/cli/commands/enrich.ts](../../src/cli/commands/enrich.ts)
- [test/autobuild-wrapper.test.ts](../../test/autobuild-wrapper.test.ts)
- [src/targets/lock.ts](../../src/targets/lock.ts)
- [compose.yml](../../compose.yml)
