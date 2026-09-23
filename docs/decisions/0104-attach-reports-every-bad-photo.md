# 0104. `attach` ingests every `--photo` and reports every failure, not just the first

- **Status:** Accepted
- **Date:** 2026-09-22
- **Area:** Photos and covers

## Context

`ingestAttachments` processed a batch of `--photo` paths in a plain sequential
loop with no `try`/`catch`. The first file that failed to read threw
immediately, aborting the whole call before the rest were even attempted — and
since `stage()` is only reached after the loop returns, nothing from the batch
was ever committed, good files included. The error named only that one file.

A real incident: an agent held two photos to attach at session close, tried to
reconstruct their paths from memory two minutes later, and fabricated both. The
first fabricated path failed and aborted the call; the second was never even
tried. The agent's own report — "two photos were lost" — was not verified, it
was inferred, because the tool itself had only ever told it about one.

## Decision

Every `--photo` is attempted regardless of an earlier one failing. Failures are
collected, and if any occurred, a single `error.photo_ingest_failed` is thrown
naming every bad path (`{count}`, a joined `{files}` for the message, and a
structured `details.failures[]` — `{path, key, params}` per file — for a JSON
caller). The batch stays all-or-nothing: nothing here calls `stage()`, so a
failure still commits no attachment, good files included. What changes is that
one round trip now reports every problem instead of the first.

## Consequences

A caller — human or model — learns the full extent of a failed batch from one
invocation, and can act on exactly what is wrong rather than fixing one file
and discovering more on retry. Cost: `ingestAttachments` no longer short-
circuits on the first bad file, so a batch with several bad paths still reads
every one of them (the file-read attempt, not just a stat) before reporting —
negligible against the network-free, local nature of the operation.

This does not make a partial success possible, and should not be read as an
invitation to add one: the atomicity (throw before `stage()`, or commit
everything) is what keeps one `attach` call mapping to one coherent event.

## Related

- [src/cli/attachments.ts](../../src/cli/attachments.ts)
- [src/images/ingest.ts](../../src/images/ingest.ts)
- [test/photo-cli.test.ts](../../test/photo-cli.test.ts)
