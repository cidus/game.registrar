# 0015. An unknown configuration key is a usage error

- **Status:** Accepted
- **Date:** 2026-08-18
- **Area:** Configuration

## Context

Phantom or misspelled config keys were silently ignored (the fix commit dropped phantom obsidian keys).

## Decision

An unknown key in gamereg.config.json is a usage error (exit 2, error.unknown_config_key) naming the key and the valid ones. Valid names are derived from DEFAULT_CONFIG so no second list can drift. The same applies inside platform entries.

## Consequences

A config written by a newer gamereg can break an older binary. Accepted for 'one user, one machine'. Reopen: distribution to strangers (1.0) weakens that premise.

## Related

- [src/core/config.ts](../../src/core/config.ts)
- [test/config.test.ts](../../test/config.test.ts)
- docs/spec/02-cli.md:570-575
