# 0046. UNBUILT_TARGETS marks a target that is current but not yet built

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Build and targets

## Context

Bumping CURRENT_PHASE to 3 for stats also let quartz pass the vocabulary gate. That would have turned a clean 'arrives in phase 3, this version builds through 2' (exit 2 at config time) into an exit 1 from the registry at build time: later, vaguer, and after the vault already declared it.

## Decision

A phase ships in steps, so a target can be current and still unbuilt. UNBUILT_TARGETS in core/vocab.ts names those, and checkTarget refuses them with exit 2 (usage, error.unimplemented_target) where they are named, so init and the config reader both catch them. test/targets.test.ts asserts the list plus the registry covers BUILD_TARGET exactly once. The list is normally empty; a target leaves it in the commit that lands it (quartz did). test/init.test.ts asserts the rule over whatever the list holds. The registry's unimplemented_target throw stays as a backstop and became a usage error.

## Consequences

A second gate to maintain, guarded by tests against rot.

## Related

- [src/core/vocab.ts](../../src/core/vocab.ts)
- [src/targets/registry.ts](../../src/targets/registry.ts)
- [test/targets.test.ts](../../test/targets.test.ts)
- [test/init.test.ts](../../test/init.test.ts)
- docs/spec/07-targets.md:103-111
