---
name: Bug report
about: Something in gamereg behaves differently from what the spec says
title: ""
labels: bug
---

**Command run**

```
gamereg ...
```

**Expected behavior**

What `docs/spec/` (or the `--help` text) says should happen.

**Actual behavior**

What happened instead — exit code, stdout/stderr, or the wrong state in
`data/events.jsonl` if relevant.

**Environment**
- `gamereg --version`:
- Node version (`node --version`):
- OS:
- Vault: fresh (`gamereg init`) or existing?

**Minimal reproduction**

The smallest sequence of commands that reproduces this from a fresh vault, if
you have one. If it involves an existing vault, a relevant excerpt of
`data/events.jsonl` (with anything personal redacted) is more useful than a
description.
