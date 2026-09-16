# 0069. Prompt examples are whole tool calls, never payload fragments

- **Status:** Accepted
- **Date:** 2026-08-31
- **Area:** Agent prompt

## Context

AGENTS.md showed the button `presentation` object alone, accurate but not sufficient. The agent correctly inferred the `message` send it belongs in, then filled the send's `message` field with the literal string "placeholder" and wrote the real question as narration that went nowhere: perfect buttons, no question. Only `action` is required by the tool schema, so nothing forced a real value. This is the cost side of compressing a 56KB skill: the old file modelled the pattern three times (candidates, check-ins, confirmations), and a single compressed statement left one degree of freedom the model used.

## Decision

Examples in the always-loaded card are whole calls, not the interesting part of one. A test asserts the button example keeps its `action`, its `message`, and a real sentence in it.

## Consequences

The card grows slightly per example. The same rule was applied to the `edit` (strip-button) example after it failed three ways at once (named `to` instead of `target`, top-level `buttons` dropped silently, `message` omitted and refused 'content required'), with four consecutive live failures.

## Related

- [agent/workspace/AGENTS.md](../../agent/workspace/AGENTS.md)
- [test/agent-skill.test.ts](../../test/agent-skill.test.ts)
