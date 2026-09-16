# 0037. A version under development carries a -dev suffix

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Versioning and releases

## Context

`gamereg --version` reads `package.json`. Between two releases it therefore claimed a version that had not been released: for a stretch it reported `0.2.0` while nothing of that name existed yet, which was patched over at the time with a note rather than a convention.

## Decision

A version under development carries the SemVer prerelease suffix `-dev` — `1.0.0-dev` — and the suffix is dropped only in the commit that gets tagged. No per-commit bookkeeping (`-dev.1`, `-dev.2`): the suffix alone carries the meaning, since the tool is installed from source or from a tagged image rather than pulled by version number.

## Consequences

Exactly one commit per release carries a plain version, and it is the tagged one.

The release procedure has two version bumps: one to drop the suffix, one to open the next window.

## Related

- CLAUDE.md "## Versioning" (-dev paragraph)
