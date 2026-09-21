# 0056. The example import mapping lives in the guide, not in templates/

- **Status:** Accepted
- **Date:** 2026-08-23
- **Area:** Documentation

## Context

templates/ holds what is seeded into every vault (Game Database.base, quartz.config.yaml). A mapping file names one spreadsheet's column headers, which differ for every user and often for every export.

## Decision

No example mapping ships in templates/. docs/getting-started.md, 'Coming from a spreadsheet', carries the worked mapping as a code block next to the CSV it maps and the --dry-run output it produces, so the three read as one unit.

## Consequences

A shipped example would be copy-pasted with headers that match nobody's CSV, which is worse than no example.

## Related

- templates
- [docs/getting-started.md](../getting-started.md)
- [docs/spec/02-cli.md](../spec/02-cli.md)
