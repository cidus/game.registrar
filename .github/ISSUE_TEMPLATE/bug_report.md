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

What happened instead: the exit code, stdout/stderr, or the wrong state in
`data/events.jsonl` if relevant.

**Environment**
- `gamereg --version`:
- How it is installed: from source, npm link, or the container image
- Node version (`node --version`), if not using the container:
- OS:
- Vault: fresh (`gamereg init`) or existing?

**Container (optional, if you run the published image)**
- Image tag (`GAMEREG_IMAGE_TAG`, default `edge`) or digest
  (`docker image inspect --format '{{index .RepoDigests 0}}' <image>`):
- Enabled compose profiles (`site`, `comments`, `tunnel`, or none):
- OpenClaw version from the image (`docker compose exec gateway openclaw --version`):

**Minimal reproduction**

If you have one, give the smallest sequence of commands that reproduces this
from a fresh vault. If it involves an existing vault, an excerpt of
`data/events.jsonl` (with anything personal redacted) is more useful than a
description. For the container, include the relevant lines of
`docker compose logs`, with tokens and chat ids redacted.
