# 0028. Installation is generated declarative configuration; preferences in chat, secrets never

- **Status:** Proposed
- **Date:** 2026-08-21
- **Area:** Container deployment

## Context

The shape of distribution was settled early so the earlier phases would not paint it into a corner.

## Decision

(1) A generator collects secrets and connectivity and emits declarative configuration (compose file plus environment). It never becomes part of the runtime. (2) The image pins CLI, gateway, skill and persona together. (3) Pure preferences (timezone, platforms, which targets) are asked in chat by a second skill with its own binary, gated by `requires.bins`, and removed from PATH and the exec allowlist once setup finishes. That keeps AGENTS.md's boundary: the agent executes one allowlisted binary and writes no file. Two constraints: the system must work with no conversation at all (defaults apply; the wizard refines and never gates), and no secret is ever collected in chat, because transcripts land in plaintext in ~/.openclaw/agents/<agent>/sessions/*.jsonl.

## Consequences

'Phase 4, deliberately last' and 'Nothing here is built' are now partly stale. Phase 4 is the current phase (package.json:3 '1.0.0-dev'). The container image is built and published to ghcr as:edge (.github/workflows/image.yml:116-224, commit 8649b80 on 2026-09-13). compose.yml exists but is hand-written ('generated_by: hand', compose.yml:33; 'hand-written now and generated later',:3). Still unbuilt: the generator, `targets --json` (no targets command in src/cli/commands/), the second setup skill (the only requires.bins is SKILL.md:4 for gamereg), and a published npm package (install is still `npm link`, README.md:143, docs/getting-started.md:19).

## Related

- [docs/spec/06-roadmap.md](../spec/06-roadmap.md)
- [docs/spec/00-architecture.md](../spec/00-architecture.md)
- [compose.yml](../../compose.yml)
- Dockerfile
- [.github/workflows/image.yml](../../.github/workflows/image.yml)
- [package.json](../../package.json)
- [agent/skills/gamereg/SKILL.md](../../agent/skills/gamereg/SKILL.md)
- docs/spec/06-roadmap.md "Phase 4" bullets
