# 0055. One images.publish switch, rendered as well as obeyed

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Site and comments

## Context

Personal photos should not leak to a public site by default. A site missing the files must not show broken embeds.

## Decision

With images.publish off (default false): the site shows a placeholder saying a picture was withheld instead of embedding a missing file; the run note's cover property is omitted; the cover column renders empty. With it on: targets/mirror.ts hardlinks assets into quartz/content/assets, the same add-only pass obsidian/assets gets, outside the manifest and not a planned file.

## Consequences

Both halves must move together: rendering the embed without the mirror is a broken page, and mirroring without rendering is dead bytes.

## Related

- [src/render/flavour.ts](../../src/render/flavour.ts)
- [src/render/assets.ts](../../src/render/assets.ts)
- [src/render/run.ts](../../src/render/run.ts)
- [src/targets/build.ts](../../src/targets/build.ts)
- [src/targets/mirror.ts](../../src/targets/mirror.ts)
- [src/core/config.ts](../../src/core/config.ts)
- docs/spec/06-roadmap.md "## Decided" item 1
- docs/spec/04-derived.md:481-486
