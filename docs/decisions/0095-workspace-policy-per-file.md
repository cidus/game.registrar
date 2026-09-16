# 0095. The container decides each workspace file's policy per file

- **Status:** Accepted
- **Date:** 2026-09-13
- **Area:** Container deployment

## Context

docker/entrypoint.sh classified the gateway's workspace by folder: skills/ is code and replaced every boot; workspace/*.md is persona and seeded once. Its comment claimed to apply 'the same split targets/ already draws between write policies', but it did not: in targets/ a `seed` (Game Database.base) sits beside `replace` notes in one tree, because the policy belongs to the file. Borrowing the vocabulary without the granularity put AGENTS.md on the wrong side. AGENTS.md is the standing orders (exec boundary, exit codes, verified button payloads, routing table, confirmation protocol), every line asserted against the real binary and SQL schema by test/agent-skill.test.ts. The cost was a release in which an image upgrade shipped new code with the old procedure and said nothing: `grep -c run_close_event_id /config/workspace/AGENTS.md` answered 0 on a container built from a tree that had it.

## Decision

A file whose correctness is enforced by CI is not the user's file. WORKSPACE_REPLACE (AGENTS.md, TOOLS.md) is copied every boot, with a backup if it differed; everything else is seeded with hash tracking. A test asserts the classification matches the shipped directory and that AGENTS.md is in the replace list.

## Consequences

A conversation already under way keeps its loaded copy (needs /reset). Stale comments remain: Dockerfile:73-76 still says 'workspace persona files are the user's and are seeded only when absent' (the per-directory model), and entrypoint.sh:382-385 says a default AGENTS.md written by onboard 'would win permanently' because the deploy step 'will not replace' an existing file, which is no longer true for AGENTS.md.

## Related

- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- Dockerfile
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
- [agent/README.md](../../agent/README.md)
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
