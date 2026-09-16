# 0062. Vault maintenance is a periodic external script

- **Status:** Accepted
- **Date:** 2026-08-26
- **Area:** Container deployment

## Context

SKILL.md had the agent fire `gamereg enrich` and `gamereg build` as backgrounded, unreported exec calls, and ignore non-zero exits. build's lockfile exits 5 immediately rather than queuing, so two session closes near each other silently lost the second build. The alternative considered was teaching enrich and build to fork and return immediately instead of relying on the exec tool's background param.

`enrich --missing` made an external sweep cheap.

A self-backgrounding flag on gamereg was considered and rejected under invariant 5: `enrich` is the only network command and stays synchronous so a caller has one observable success point.

## Decision

Rejected against invariant 5: enrich is kept the one command that reaches the network, synchronous and separate, so a caller (test, script, person reading the exit code) has one observable point where success is knowable. A self-backgrounding enrich returns before that point exists, the same failure as the old 'ignore non-zero exit' rule moved into the binary. Instead, scripts/autobuild.sh polls `git status` in the vault and, when dirty, runs `enrich --missing --covers`, then `build`, then commits and pushes. Every gamereg call inside it is synchronous; only the script itself runs periodically (systemd --user timer on a host, docker/loop.sh in the container).

A self-backgrounding CLI flag was rejected (invariant 5).

It keeps no state beyond the repository, so a missed or overlapping tick just finds more to do. The agent runs `gamereg build` only when the user asks in the moment.

## Consequences

The agent runs build only when the user asks. The tools.exec.notifyOnExit risk (a finishing background call enqueuing a heartbeat that wakes the agent to comment unprompted) was not fixed; it stopped applying, with no config change. Git status is the only state, so a freshly seeded vault must be committed or every tick enriches again.

Maintenance is eventually consistent, one tick later. Do not add an async flag to enrich or build.

Derived output lags by one timer interval (GAMEREG_AUTOBUILD_INTERVAL, 600s default). Every gamereg call inside the script stays synchronous; only the script is backgrounded. Do not add an async or fork flag to enrich/build.

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
