# 0060. The site gets the Stats page and reviews, but no client-side filtering

- **Status:** Accepted
- **Date:** 2026-08-26
- **Area:** Site and comments

## Context

Both were raised together when the site's Stats page was built. The heatmap/review port was mechanical: render/heatmap.ts and render/review.ts are pure functions of folded state, the seam html already used.

noteRef gained a 'reviews' folder, and the review/stats emitters take a Flavour. quartz.ts plans content/stats.md, content/reviews/<year>.md and heatmap SVGs with no images.publish gate, because this is generated data. index.md is untouched; Stats is reached through Quartz's explorer. Client-side JS filtering was declined.

## Decision

quartz plans content/stats.md, content/reviews/<year>.md and content/reviews/heatmap-<year>.svg, with no client-side JS filtering or sorting. Reason 1: it would blur the boundary 07-targets.md draws (html is a self-contained JS page, quartz a document publisher: Markdown in, linked site out), and the Astro open item reserves data-driven cross-cutting features for a second generator. Reason 2: whether a <script> tag survives Quartz's Markdown/HTML pipeline is untested here, the same gap quartz.config.yaml has.

Port Stats and reviews to quartz through Flavour; no images.publish gate for generated SVG; no html-style JS filtering on quartz.

## Consequences

If filtering is ever wanted, go the Astro path fed a projection, not a <script> smuggled into quartz/content/.

## Related

- [src/targets/quartz.ts](../../src/targets/quartz.ts)
- [src/render/review.ts](../../src/render/review.ts)
- [src/render/heatmap.ts](../../src/render/heatmap.ts)
- [src/targets/html.ts](../../src/targets/html.ts)
- [docs/spec/07-targets.md](../spec/07-targets.md)
- [src/render/flavour.ts](../../src/render/flavour.ts)
- [example-vault/quartz/content/stats.md](../../example-vault/quartz/content/stats.md)
- example-vault/quartz/content/reviews
