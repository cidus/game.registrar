# 0049. The heatmap renderer returns a string and the target decides where it goes

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Stats and year in review

## Context

The same calendar heatmap is needed in Obsidian notes, a single HTML page and the Quartz site.

## Decision

heatmapSvg returns an SVG string. stats writes obsidian/reviews/heatmap-<year>.svg and embeds it as a Markdown image with a path relative to the note's own folder; html pastes the SVG inline; quartz writes content/reviews/heatmap-<year>.svg. A relative Markdown image is the one spelling Obsidian, GitHub and a static site generator all resolve identically; a wikilink embed is Obsidian-only, and GitHub's sanitizer strips inline SVG inside Markdown. Level thresholds are fixed, not per-year quantiles, so two years can be read side by side.

## Consequences

Thresholds are 60/120/240 minutes. One renderer, three consumers (the shared-renderer seam).

## Related

- [src/render/heatmap.ts](../../src/render/heatmap.ts)
- [src/render/review.ts](../../src/render/review.ts)
- [src/targets/stats.ts](../../src/targets/stats.ts)
- [src/targets/html.ts](../../src/targets/html.ts)
- [src/targets/quartz.ts](../../src/targets/quartz.ts)
- docs/spec/04-derived.md:328-333 (fixed level thresholds)
