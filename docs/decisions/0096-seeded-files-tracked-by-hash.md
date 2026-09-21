# 0096. Seeded workspace files are tracked by hash

- **Status:** Accepted
- **Date:** 2026-09-13
- **Area:** Container deployment

## Context

Seeding once and never overwriting protects an edit by punishing everyone who never made one: they keep the first boot's copy forever, silently.

## Decision

Record the sha256 of what was seeded. Unchanged since seeding: nobody is overruled, so the file follows the image with no action. Changed: it is the user's, kept and said out loud, naming the shipped copy and noting that deleting theirs takes the new one. No record (an install predating tracking): stay conservative. Adopt only if byte-identical to the shipped default; otherwise keep it loudly, never writing the current hash, because that would mark someone's edit as factory and the next boot would overwrite it.

## Consequences

The first draft had the no-record branch silent, which would have rebuilt the original bug one level down (a file not updated, and nothing saying so). Notices are one log line each with the `entrypoint:` prefix, so they survive `docker logs | grep entrypoint` (fix 7431d32). A seeded file that differs from its record while the shipped default is unchanged stays silent.

## Related

- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [agent/README.md](../../agent/README.md)
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
