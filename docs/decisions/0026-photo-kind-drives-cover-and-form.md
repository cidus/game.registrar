# 0026. A photo's kind decides the cover offer and the physical-media inference

- **Status:** Accepted
- **Date:** 2026-08-20
- **Area:** Photos and covers

## Context

The kind of a photo (screenshot, photo, box, media, other) is advisory metadata in the model but drives two agent behaviours.

## Decision

In the agent, kind is load-bearing. A box or media photo becomes the cover (--as-cover) when the game has none, with no question because nothing is replaced, and is offered as a replacement (cover-replace:<game ref>) when one exists. The same photo arriving with start adds --form physical, mentioned aloud the way an inferred platform always is.

## Consequences

Misclassifying a box photo as a screenshot breaks both behaviours. Inference applies only on start/past; changing form later is an amend, offered and confirmed. The CLI itself infers nothing from kind.

## Related

- [agent/skills/gamereg/reference/media.md](../../agent/skills/gamereg/reference/media.md)
- [src/cli/attachments.ts](../../src/cli/attachments.ts)
- [src/core/vocab.ts](../../src/core/vocab.ts)
