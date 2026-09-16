# CLAUDE.md

Briefing for a coding session on this repository.

`gamereg` is a CLI that records video game playthroughs into an append-only
event log and regenerates Markdown notes, a consolidated table, exports, a
SQLite cache and site content from that log. An optional chat agent sits on top
and does nothing but invoke the CLI.

## Read first

| Before you | Read |
|---|---|
| write any code | [docs/spec/00-architecture.md](docs/spec/00-architecture.md), then [01-model.md](docs/spec/01-model.md) |
| touch the build | [07-targets.md](docs/spec/07-targets.md) — the build is a registry of targets, not a single emitter |
| change something that looks arbitrary | [docs/decisions/README.md](docs/decisions/README.md) — 100 decision records. Most exist because the obvious alternative was tried and cost something |
| write documentation | [docs/development/documentation.md](docs/development/documentation.md) |
| write tests | [docs/development/testing.md](docs/development/testing.md) |
| touch the agent | [docs/explanation/agent-design.md](docs/explanation/agent-design.md) and [agent/README.md](agent/README.md) |

The specs describe the system. This file is only what a session needs on top of
them.

## Current state

- `package.json` is `1.0.0-dev`; the latest tag is `v0.3.0`. The version under
  development carries `-dev` until the commit that is tagged.
- The CLI records sessions, runs and verdicts, enriches from IGDB, ingests
  photos, imports a spreadsheet, and builds these targets: `obsidian`, `csv`,
  `sqlite`, `json`, `html`, `stats`, `quartz`.
- The agent layer (`agent/`) is an OpenClaw deployment on Telegram with voice,
  check-ins and reaction tokens that ship with the gateway switches off.
- The container image is built and published by CI to `ghcr.io/cidus/gamereg`
  as `:edge` and `:sha-<commit>`; `compose.yml` runs from it with no clone.
  Optional profiles: `site`, `comments`, `tunnel`.
- Not built yet: an npm package, the configuration generator, first-run setup
  as a conversation, and a workflow that builds the site.
- `npm test` runs the suite (`node --test`, no framework, no network);
  `npm run typecheck`; `npm run test:live` is opt-in and needs IGDB
  credentials. Do not quote test counts in documentation — they rot.

## Where things live

```
src/            cli/ commands · core/ events, fold, time, config, platforms
                resolve/ · render/ · targets/ · db/ · providers/ · images/ · i18n/
agent/          the OpenClaw deployment: prompt (workspace/, skills/), examples, checkin.sh
docker/         entrypoint and the maintenance and site loops
scripts/        autobuild, vendor-quartz, systemd units
docs/           getting-started · guides/ · reference/ · explanation/ · spec/ · decisions/ · development/
example-vault/  fixtures: a fictional log and the expected output of every target
test/           node:test, golden files, wrapper tests
```

Where new knowledge goes:

| What you learned | Where it belongs |
|---|---|
| A decision, and the story that forced it | A new record in `docs/decisions/`, plus its row in the index |
| A symptom someone will hit again | [docs/guides/troubleshooting.md](docs/guides/troubleshooting.md) |
| A user-visible change | `CHANGELOG.md` under `[Unreleased]` |
| How something works and why | `docs/explanation/` |
| A rule the agent must follow | `agent/workspace/AGENTS.md` — the rule only; the incident goes in the record |

Not here. This file grew to 99 KB by accumulating narrative one paragraph at a
time, which is exactly the failure the split above prevents.

## Non-negotiables

The same list as [00-architecture.md](docs/spec/00-architecture.md#invariants),
same numbering: "invariant 5" and "non-negotiable 5" are one rule.

1. `data/events.jsonl` is append-only. No code path rewrites or deletes a line.
2. `gamereg build` is idempotent — byte-identical output on a second run,
   including binary targets.
3. Nothing outside `<!-- gamereg:... -->` markers is modified in a note.
4. Delete every derived artifact, rebuild, lose nothing. A build argument
   narrows a build; it never defines what the vault contains.
5. No write command performs network I/O. `enrich` and `search` are the only
   commands that reach a provider, and `search` records nothing.
6. Every state mutation appends at least one event.
7. Durations, ratings and session state are computed in code. Never inferred.
8. A target reads the folded state and the config. Nothing else — not the
   filesystem, not the network, not its own output, not another target's.
9. The build removes only what the manifest says it owns. Never by pattern,
   never a seeded file, never at all when the manifest is missing.
10. SQLite is a cache, never a source of truth.
11. A user cover (`source: user`) is never replaced by enrichment. Only
    `cover --reset` gives provider art back.
12. GPS and the rest of EXIF are stripped on ingest. Not configurable off.
13. Output format and interactivity are two independent axes, both defaulted
    from the environment. The interactive menu is a presenter over the same
    candidate array a JSON caller gets — never a second resolution code path.
14. Every configurable value can be set without a TTY.
15. Nothing is coupled to an install path. The vault is wherever `--vault` or
    `GAMEREG_VAULT` says, and `i18n/`/`templates/` are found relative to the
    code.

If a task seems to require breaking one of these, stop and raise it rather than
working around it.

## Conventions

- TypeScript, ESM, Node 22.18+. `strict: true`, no `any` in `core/`.
- Errors carry the exit code from [02-cli.md](docs/spec/02-cli.md#exit-codes).
  One error class, a `code` field.
- All user-facing strings come from `i18n/`. No hardcoded English in `src/`,
  including error messages — `core/platforms.ts` holds English platform names
  as *data*, which is the one deliberate exception.
- The persona belongs to prose output only. JSON output and event payloads stay
  neutral.
- Everything this repository writes is in English: code, comments, docs, commit
  messages, issues, and the agent's prompt. The exceptions are data:
  `i18n/*.json`, the pt-BR command table in `02-cli.md`, `example-vault/`, the
  human-owned section of `README.md`, and `Pokémon` as a Unicode fixture.
- Commit messages: conventional commits, English.
- Phase numbers belong to [06-roadmap.md](docs/spec/06-roadmap.md) and to
  documents telling the story of when something happened. Never in code, in a
  spec, or in a page describing how things are today —
  `test/phase-citations.test.ts` enforces it.
- **When a change adds or alters a capability, re-read `README.md`'s *Status*
  and `docs/getting-started.md`.** Every other document has an obvious owner;
  those two belong to nobody and go stale first. Ask whether any sentence in
  them is now untrue, not whether they mention the new thing.

## Rules for this session

- **Never tag, push or bump a version unless asked.** Releasing is
  maintainer-triggered: [docs/development/releasing.md](docs/development/releasing.md).
- **Ask rather than assume** about: a schema change to `01-model.md`; a new
  build target, or a target that needs to read anything but folded state; a new
  runtime dependency beyond the stack table in `00-architecture.md`; anything
  that writes outside the vault root.
- **Protected regions.** Text between `<!-- human-owned -->` and
  `<!-- /human-owned -->`, in any file in this repository, is never edited,
  rewritten, reworded, or deleted by an AI session — not even as a side effect
  of a broader edit to the same file, and not even if the surrounding request
  seems to call for it. If a change appears to require touching a protected
  region, stop and ask instead of editing around it or through it. The marker
  pair is the author's own, added by hand; nothing in tooling enforces it —
  this rule is what enforces it.

## Open items

- **Packaging and first-run setup are not built.** The shape is settled in
  [ADR 0028](docs/decisions/0028-install-is-generated-config.md) (Proposed):
  a generator emits declarative configuration, preferences are asked in chat by
  a second skill, and no secret is ever collected in a conversation.
- **No workflow builds the site.** The default topology builds it off-box from
  the vault's own repository
  ([ADR 0036](docs/decisions/0036-site-built-off-box-by-default.md));
  `scripts/vendor-quartz.sh` is a recipe that has been run for real, not an
  answer to hosting.
- **A second generator fed data, rather than Markdown, is reserved** for
  cross-cutting pages and charts
  ([ADR 0058](docs/decisions/0058-astro-gets-a-projection.md), Proposed).
  `data/export.json` is not that artifact and must not be widened into it.
- **Gaby has no `SOUL.md`.** The second persona is drafted only inside
  Veronika's, and lands with board games, which sit after 1.0.
- **A host install still registers the check-in job by hand**
  ([docs/guides/deploy-host.md](docs/guides/deploy-host.md)); the container
  does it in a one-shot service.
- **`agent/workspace/AGENTS.md` still lists check-in questions as a use of the
  `message` tool**, while the wake forbids that tool. Worth reconciling the
  next time the card is edited.
- **The maintainer's host notes may predate the container deployment**: a vault
  at `/opt/gamereg-vault` and `/usr/bin/gamereg` pointing into a checkout's
  `dist/`, which is why a stale `dist/` makes the live agent run old code.
  Production now runs from the image.
