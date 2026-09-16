# 0008. amend and revoke are confirmed in conversation, not by an approval gate

- **Status:** Accepted
- **Date:** 2026-08-15
- **Area:** Corrections

## Context

Live testing found the approval UI unreliable. The approval prompt shows raw command text and a UUID; with routing incomplete, the agent fabricated an approval id / a plausible `/approve <uuid>` instead of reporting it was stuck. Fixing that display is outside this repo's control. The gated variant was built and abandoned.

The alternative was built and abandoned: excluding amend/revoke from the exec allowlist so they fall to OpenClaw's approval prompt. That prompt shows raw command text and a UUID, and with routing incomplete the agent invented a plausible `/approve <uuid>` instead of reporting it was stuck. The display is outside this repo's control. Earlier live finding: the project's working notes records the agent fabricating an approval id.

## Decision

amend and revoke sit on the exec allowlist like every other gamereg command. Confirmation is a conversational protocol: state what will change (game, field, old and new value), offer buttons, wait for an unambiguous yes, run, strip the button. A vague 'sure', a change of subject or silence is not a yes.

`amend` and `revoke` stay on the allowlist like every gamereg command. Confirmation is a conversational protocol: state exactly what will change, offer it with buttons, wait for an unambiguous yes, run it with `--reason`, then strip the button.

## Consequences

Nothing structurally stops a wrong amend if the model misjudges; it is merely against instructions. The append-only log means a bad amend costs one more amend, never data. The harder guarantee needs all four of: exclude amend/revoke from approvals.example.json, tools.exec.mode 'ask', approvals.exec {enabled: true, mode: 'session'}, and channels.telegram.execApprovals with an explicit approvers list. Missing any one makes a gated command fail with no way to approve it.

Nothing mechanically stops a wrong amend if the model misjudges the conversation; it is against instructions, not impossible. The append-only log means one more amend or revoke repairs it and no data is lost. The harder guarantee needs all four of: amend/revoke excluded from approvals.example.json, `tools.exec.mode: "ask"`, `approvals.exec: {enabled: true, mode: "session"}`, and an explicit `channels.telegram.execApprovals.approvers` list. Reopen if OpenClaw's Telegram approval UI becomes reliable.

## Related

- [agent/approvals.example.json](../../agent/approvals.example.json)
- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [agent/skills/gamereg/reference/corrections.md](../../agent/skills/gamereg/reference/corrections.md)
- [agent/README.md](../../agent/README.md)
- [agent/openclaw.example.json5](../../agent/openclaw.example.json5)
- [docs/spec/05-agent.md](../spec/05-agent.md)
- docs/spec/05-agent.md:692-707 (Safety; dry-run rehearsal that died on an approval timeout)
