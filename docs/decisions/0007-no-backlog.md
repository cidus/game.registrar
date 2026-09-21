# 0007. The register holds what was played; there is no backlog view

- **Status:** Accepted
- **Date:** 2026-08-13
- **Area:** Data model

## Context

Every tracker eventually grows a list of games you intend to play. It is a different data model — it needs ownership, wishlists and priorities — and it answers a different question from the one this tool exists for.

## Decision

The register holds what you played. A game enters the model with a run; there is no `game.add` without one, and no backlog view.

## Consequences

It is not a library manager: it does not know what you own and does not suggest what to play next.

A game can still end up with no runs — by revoking the run that created it — and it is reported as `unplayed` rather than being deleted, because the log is append-only.

A wishlist is a text file in the same repository, if you want one. It is not the register's business.

## Related

- docs/spec/06-roadmap.md "## Decided" item 5
- docs/spec/00-architecture.md "## Non-goals" (not a library manager)
