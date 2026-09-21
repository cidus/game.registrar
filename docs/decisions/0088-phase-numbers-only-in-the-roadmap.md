# 0088. Phase numbers appear only in the roadmap and in narrative documents

- **Status:** Accepted
- **Date:** 2026-09-04
- **Area:** Documentation

## Context

Phase numbers are built to move: reordering them is a product decision, not a rename, so any citation rots when that decision is taken. Moving distribution ahead of board games made src/core/fold.ts, 01-model.md and PERSONAS.md wrong in a single commit, because all three said 'phase 4' about board games. The first draft of the rule was absolute. The commit that introduced it violated it, and the project's working notes broke it about 20 times.

## Decision

Never cite a phase number in src/ or in any spec except 06-roadmap.md. In comments and specs, say what the work is ('reserved for board games') and let the roadmap own where it sits. Narrative documents (the project's working notes, CHANGELOG.md, the agent deployment notes, tag messages) may cite phases, because 'phase 3 shipped without this' is a claim about history. A forward reference ('this field is for phase 4') is a pointer, and pointers rot. The invariant numbering follows the same rule: a number is safe to cite only if it is guaranteed never to be renumbered, or if it is not a forward reference.

## Consequences

test/phase-citations.test.ts enforces this for src/**/*.ts and docs/spec/*.md (roadmap excluded), using the regex `/\bphases?[\s-](\d+)\b/i`. Shell scripts, agent/, and numeric constants are not scanned. Reopen only if phases stop being reorderable.

## Related

- [test/phase-citations.test.ts](../../test/phase-citations.test.ts)
- [src/core/fold.ts](../../src/core/fold.ts)
- [docs/spec/06-roadmap.md](../spec/06-roadmap.md)
- [agent/PERSONAS.md](../../agent/PERSONAS.md)
- [docs/spec/01-model.md](../spec/01-model.md)
- [agent/checkin.sh](../../agent/checkin.sh)
- [src/core/vocab.ts](../../src/core/vocab.ts)
- [docs/spec/07-targets.md](../spec/07-targets.md)
