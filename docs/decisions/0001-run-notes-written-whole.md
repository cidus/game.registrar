# 0001. Run notes are written whole; game notes are spliced

- **Status:** Accepted
- **Date:** 2026-08-12
- **Area:** Build and targets

## Context

The build regenerates every derived file from the log, and two kinds of Markdown are not the same kind of file. A game note accumulates a reader's own writing over years. A run note is a record of one playthrough: dates, hours, rating, the list of sessions — all of it derived, all of it rewritten whenever the log gains an event.

Preserving prose costs a protocol: the note is parsed, the region between `<!-- gamereg:... -->` markers is replaced by offset, and everything else is left byte for byte. That protocol is worth paying for where people write, and pointless where they do not.

## Decision

Game notes, the consolidated table, the stats page and the year-in-review notes are **spliced**: only the marked regions change. Run notes, the CSV, JSON and HTML exports, the SQLite cache, the heatmap images and the site's content are **written whole**. Configuration-shaped files — the seeded `Game Database.base` and `quartz.config.yaml` — are **seeded** once and then belong to the reader.

`runs/` is data; `games/` is yours.

## Consequences

Anything typed into a run note is gone at the next build, which is why `doctor` reports prose found there.

The promise "nothing you wrote by hand is ever rewritten" is therefore narrower than it sounds, and the tutorial and the README have to say which files it covers.

Do not "fix" this by giving run notes markers too: every generated file would become a merge surface, and the thing that makes the build safe is that most of its output is disposable.

## Related

- docs/spec/04-derived.md:234-245 ("Written whole")
- src/targets/obsidian.ts:53-61
