# Documentation

This is the map of everything written about the Registrar, grouped by what you
need to do. New to the project? Start with the [tutorial](getting-started.md).
For an overview, read the [project README](../README.md).

## How this documentation is organized

The pages follow [Diátaxis](https://diataxis.fr/). Each page is one of four
kinds and does only that job: a tutorial, a how-to guide, a reference or an
explanation. Troubleshooting is indexed by symptom. The specification under
`spec/` is normative, and code and tests cite it by path. Decisions, with the
context that forced each one, are kept as
[Architecture Decision Records](https://adr.github.io/) (ADRs) under
`decisions/`. That way a guide can state a rule in one sentence and link to the
reason. [development/documentation.md](development/documentation.md) explains
where a new page belongs.

## Start here

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Tutorial: install the CLI, create a register, record a session and build the outputs. Then add metadata and the chat agent if you want them. |
| [Deploy with containers](guides/deploy-container.md) | The other way in: run the register, the agent and vault maintenance from the published image, with no clone. |

## How-to guides

| Guide | What it helps you do |
|---|---|
| [Import a spreadsheet](guides/import-spreadsheet.md) | Move an existing spreadsheet into the register with `gamereg import`, a column mapping and a dry run. |
| [Metadata and covers](guides/metadata-and-covers.md) | Set up IGDB credentials, run `enrich`, manage cover art and attach your own photos. |
| [Build outputs](guides/build-outputs.md) | Choose build targets, open the Obsidian vault, generate stats and query the SQLite database. |
| [Fix mistakes](guides/fix-mistakes.md) | Correct or withdraw recorded events with `amend`, `revoke` and `alias`, and check the log with `doctor`. |
| [Chat agent](guides/chat-agent.md) | Set up the chat agent: gateway, model, voice, reactions and a smoke test. |
| [Deploy with containers](guides/deploy-container.md) | Install with Docker Compose from the published image, then update, pin a version or roll back. |
| [Deploy on a host](guides/deploy-host.md) | Install the agent directly on a machine, without containers. |
| [Publish a site](guides/publish-site.md) | Turn the `quartz` target's output into a public site, built off-box or with the `site` profile. |
| [Comments](guides/comments.md) | Add Remark42 comments to the site. |
| [Troubleshooting](guides/troubleshooting.md) | Look up a symptom to find its cause and fix, for the CLI, the agent and the container. |

## Reference

| Page | What it lists |
|---|---|
| [Configuration](reference/configuration.md) | Every key in `gamereg.config.json` and `gamereg.secrets.json`, with types and defaults. |
| [Environment](reference/environment.md) | Every environment variable, grouped by the component that reads it. |
| [Container](reference/container.md) | Compose services, profiles, mounts, the boot sequence and the workspace file policy. |
| [01-model](spec/01-model.md) | The data model: entities, the event envelope, event types, controlled vocabularies and derived state. |
| [02-cli](spec/02-cli.md) | Every command and flag, the [exit codes](spec/02-cli.md#exit-codes) and the [output contract](spec/02-cli.md#output-contract). |
| [03-resolution](spec/03-resolution.md) | How a title resolves to a game, and what happens when it is ambiguous. |
| [04-derived](spec/04-derived.md) | Every derived artifact, the marker protocol, and the SQLite tables and views. |
| [07-targets](spec/07-targets.md) | Build targets: the contract, how a vault declares them, and ownership and cleanup. |

## Explanation

| Page | What it explains |
|---|---|
| [How it works](explanation/how-it-works.md) | The event log, the fold and the targets; game, run and session; markers; the boundary between the CLI and the agent. |
| [Agent design](explanation/agent-design.md) | The agent layer: its boundary, how the prompt is laid out, the tool surface and check-ins. |
| [Security](explanation/security.md) | The threat model of a deployment and what each component can reach. |
| [00-architecture](spec/00-architecture.md) | The decisions, non-goals and invariants that everything else follows. |

## Specification

The specs describe how the system is meant to behave. If a guide and a spec
disagree, the spec wins and the guide is the page to fix.

| Spec | Contents |
|---|---|
| [00-architecture](spec/00-architecture.md) | Problem, decisions D1–D9, non-goals, the two repositories (tool and register), stack, invariants and threat model. |
| [01-model](spec/01-model.md) | Entities, event envelope, ordering, event types, controlled vocabularies and derived state (duration, logical day, status). |
| [02-cli](spec/02-cli.md) | Output format and interactivity, output contract, exit codes, global flags, the recording, query, attachment and maintenance commands, platform vocabulary, provider credentials and pt-BR command names. |
| [03-resolution](spec/03-resolution.md) | Resolution order, normalization, the auto-resolution threshold, candidate shape, the platform hint, alias learning and consumers. |
| [04-derived](spec/04-derived.md) | Marker protocol, game note, run note, consolidated table, Bases, SQLite, heatmap and year in review, determinism, site and image ingestion. |
| [05-agent](spec/05-agent.md) | Boundary, gateway, language, runs and sessions, voice, flows (check-ins included), persona, reactions and safety. |
| [06-roadmap](spec/06-roadmap.md) | Delivery phases and their exit criteria, what comes after 1.0, what is deferred, and questions already decided. |
| [07-targets](spec/07-targets.md) | Why more than Markdown, the target contract and write policies, declaring targets, ownership and cleanup, each target, Bases and Dataview. |

## Decisions

[decisions/README.md](decisions/README.md) is the index of Architecture
Decision Records, with the template and the process for adding one. Each record
holds one decision, the context that forced it and the costs accepted. Read the
relevant record before you change something that looks arbitrary. Many records
say what evidence would reopen the question.

## For contributors

| Page | What it covers |
|---|---|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Development setup, workflow, conventions and pull requests. |
| [Testing](development/testing.md) | The test suite, golden files, idempotency checks and the opt-in live tests. |
| [Releasing](development/releasing.md) | Versioning, the changelog, tags and GitHub releases. |
| [Documentation](development/documentation.md) | Where a new piece of documentation goes, and the style rules. |
| [SECURITY.md](../SECURITY.md) | How to report a vulnerability privately, and what is in scope. |
| [CHANGELOG.md](../CHANGELOG.md) | What changed in each release. |
| [agent/README.md](../agent/README.md) | What is in `agent/` and how each file is deployed. |
| [agent/PERSONAS.md](../agent/PERSONAS.md) | How the agent's personas are drawn. Design material that is not deployed. |
