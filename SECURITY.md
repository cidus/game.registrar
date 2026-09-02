# Security Policy

## Reporting a vulnerability

Open a [private security advisory](https://github.com/cidus/game.registrar/security/advisories/new)
on GitHub, or email github@alcid.es if you'd rather not use GitHub.
Please don't open a public issue for a suspected vulnerability.

Include what you'd include in a bug report: the command or code path
involved, expected vs. actual behavior, and a minimal reproduction if you
have one. This is a personal project with no SLA, but reports are read and
acted on.

## Supported versions

Only the latest tagged release is supported. There is no `1.0` yet (see
`docs/spec/06-roadmap.md`), so there's no long-term-support line to
backport a fix to — a fix lands on `main` and ships in the next tag.

## Scope and what matters here

`gamereg` is a local CLI over a local, append-only event log. The concrete
things worth reporting:

- **Secret handling.** `gamereg.secrets.json` (provider API credentials) is
  never logged, never written into `data/events.jsonl`, and `enrich` is the
  only command that performs network I/O (non-negotiable #5).
  If you find a path where a secret ends up somewhere else, that's a bug
  worth a private report.
- **EXIF/location data.** GPS and the rest of EXIF are stripped on image
  ingest, unconditionally (non-negotiable #12). A photo where that stripping
  doesn't happen is a privacy bug, not just a correctness one.
- **The `query` SQL allowlist** (`db/`) is a security boundary, not a
  convenience filter — it's meant to refuse anything outside a narrow
  read-only surface. A query that gets through it and shouldn't is worth a
  private report.
- **The agent layer** (`agent/`) runs commands via an exec allowlist on
  whatever gateway hosts it. Its threat model is documented in
  `agent/README.md`, including a known, accepted tradeoff (`amend`/`revoke`
  run without a platform approval gate — see that file's *Why amend/revoke
  moved off the platform gate* section). Reports about exec-allowlist
  bypasses or prompt-injection paths that reach a `gamereg` write are
  welcome regardless.

Standard web vulnerability classes (XSS, SQLi against a hosted service,
auth bypass) don't apply — there's no server and no hosted instance.
