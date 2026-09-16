# 0087. A seeded value that nothing can verify says it is a guess

- **Status:** Accepted
- **Date:** 2026-09-03
- **Area:** Site and comments

## Context

scripts/vendor-quartz.sh seeded wrangler.jsonc with name '<vault basename>-site', inventing the suffix. The real Worker was 'gamereg-vault', so the file was wrong from its first write and stayed wrong for weeks. Nothing caught it: Cloudflare dashboard builds know which Worker they are building and only warn, so every deploy that mattered worked. The mismatch only bites a manual `wrangler deploy`, which reads the file and targets a Worker that does not exist. Seed-once behaved as designed; the guess was the bug.

## Decision

Do not invent the suffix: name = basename of GAMEREG_VAULT. The seeded file says in a GUESS comment that the name cannot be verified from here, and the script prints that it is a guess. General rule: a value that is present and plausible reads as configured, and the gap only shows when something finally depends on it. The pairing and auth-store findings have the same shape.

## Consequences

The user has to compare the name with the actual Worker before a manual deploy. Seed-once still means a corrected file is never overwritten.

## Related

- [scripts/vendor-quartz.sh](../../scripts/vendor-quartz.sh)
- [test/vendor-quartz-wrapper.test.ts](../../test/vendor-quartz-wrapper.test.ts)
