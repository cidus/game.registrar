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

Fixes land on `main`. Two things follow from it:

- The container image `ghcr.io/cidus/gamereg:edge`, rebuilt from `main` on
  every push, which is what a container installation actually runs.
- The next tagged release. Only the latest tag is supported; there is no
  long-term-support line to backport to.

## Scope

The full picture is in
[docs/explanation/security.md](docs/explanation/security.md), which describes
what each component can reach and where the secrets live. The concrete things
worth reporting:

- **Secret handling.** Provider credentials (`gamereg.secrets.json` or
  `IGDB_*`), the model credential, the Telegram bot token, the gateway's access
  token, the vault's deploy key, the Remark42 signing secret and the tunnel
  token. None of them belongs in the event log, in a derived artifact, in a
  container that does not need it, or in a process's command line. A path where
  one ends up somewhere else is worth a private report.
- **EXIF and location data.** GPS and the rest of EXIF are stripped on image
  ingest, unconditionally (invariant 12). A photo — or a kept original — where that
  stripping doesn't happen is a privacy bug.
- **The `query` SQL allowlist** (`src/db/`) is a security boundary, not a
  convenience filter: it is meant to refuse anything outside a narrow read-only
  surface. A query that gets through it and shouldn't is worth a private
  report.
- **The agent layer** (`agent/`) runs commands through an exec allowlist on
  whatever gateway hosts it, with a restricted tool surface. Reports about
  allowlist bypasses, or prompt-injection paths that reach a `gamereg` write or
  read a secret, are welcome. One tradeoff is documented and accepted:
  `amend`/`revoke` are confirmed conversationally rather than by a platform
  approval gate
  ([ADR 0008](docs/decisions/0008-amend-revoke-confirmed-in-conversation.md)).
- **The container stack.** The default profile set publishes no port, mounts no
  Docker socket, and hands the internet-facing service only the variables named
  for it. The optional profiles change that: Remark42 accepts comments from
  strangers, Caddy serves the site and may proxy the comments, and the tunnel
  exposes whichever of them it points at. Issues in how this repository
  configures them are in scope; vulnerabilities in the upstream images belong
  with their projects.

The CLI on its own is a local program over local files: it has no server and no
accounts, so classic web vulnerability classes apply only to the optional
services above.
