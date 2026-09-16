# 0080. Telegram senders learn their numeric id through pairing

- **Status:** Accepted
- **Date:** 2026-09-02
- **Area:** Chat channel

## Context

Verified live; the docs had it backwards twice. No official client shows your own id. The Bot API will not resolve a @username; `openclaw channels resolve` answers 'Telegram username could not be resolved by the configured bot', even for numeric input. A username in allowFrom is worse than an error: `openclaw config validate` accepts it and only `doctor` flags it, so it matches nobody and every message is refused with nothing logged. the agent deployment notes used to describe pairing as a soft door.

## Decision

Pairing is how a user learns their id. It replies to a stranger with their own numeric id, a one-time code and the approve command, then waits; it is a request queue. Approving writes credentials/telegram-<account>-allowFrom.json and fills commands.ownerAllowFrom, leaving the config's allowFrom untouched, so the container's boot-time overlay can rerun forever without undoing a pairing. Container: TELEGRAM_ALLOW_FROM set gives dmPolicy allowlist (numeric only, anything else dies at boot); empty gives pairing.

## Consequences

The two lists never merge, because allowlist ignores the pairing store. They are alternatives, not stages. Switching to allowlist after pairing locks you out unless the id is copied into allowFrom / TELEGRAM_ALLOW_FROM.

## Related

- [docker/entrypoint.sh](../../docker/entrypoint.sh)
- [agent/README.md](../../agent/README.md)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
