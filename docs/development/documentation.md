# Writing documentation

This page covers where a new piece of documentation goes, how decision records
work, and the style rules every page follows. The map of every existing page is
[docs/README.md](../README.md).

## How the documentation is organized

The pages follow [Diátaxis](https://diataxis.fr/): each page is one kind of
document and does only that job.

| Kind | Purpose | Where |
|---|---|---|
| Tutorial | A newcomer follows it once, start to finish, and ends up with something working. | `docs/getting-started.md` |
| How-to guide | The steps toward one goal, for a reader who already knows what they want. | `docs/guides/` |
| Troubleshooting | Symptoms, each with its cause and fix. | `docs/guides/troubleshooting.md` |
| Reference | Exhaustive facts derived from the code: every key, variable or service. | `docs/reference/` |
| Explanation | How a part works and why it is shaped that way. | `docs/explanation/` |
| Specification | The normative description of the system. Code and tests cite these files by path, so their paths don't change. | `docs/spec/` |
| Decision record | One decision, the context that forced it, and the costs accepted. | `docs/decisions/` |
| Development | How to work on the project itself. | `docs/development/`, `CONTRIBUTING.md` |

Outside `docs/`:

- `README.md` is the front door: what the project is, why it exists, how to
  start, and where to go next.
- `CHANGELOG.md` lists what changed in each release.
- `SECURITY.md` explains how to report a vulnerability.
- `agent/README.md` says what is in `agent/` and how each file is deployed.
- `agent/PERSONAS.md` is design material and is deployed nowhere.
- `CLAUDE.md` is a briefing for AI coding sessions. It points into `docs/`, and
  no documentation page points back at it.

## Where a new piece goes

Ask these questions in order. The first yes decides.

| Question | Put it in |
|---|---|
| Is it a decision someone might want to reverse, or the reason something is the way it is? | A new record in `docs/decisions/` |
| Does it change how the system is meant to behave (a command, flag, event, exit code or target)? | The spec that owns it, in the same change as the code |
| Does a user see something go wrong? | An entry in `docs/guides/troubleshooting.md`, filed under the symptom |
| Is it a list of every option, key, variable or service? | A page in `docs/reference/` |
| Is it steps toward a goal? | A guide in `docs/guides/`, or a section of an existing one |
| Does it explain a mechanism or a trade-off that spans several parts? | A page in `docs/explanation/` |
| Is it about working on the repository? | `docs/development/` or `CONTRIBUTING.md` |
| Is it what changed in a release? | One line under `## [Unreleased]` in `CHANGELOG.md` |
| Is it the story of a release as a whole? | The annotated tag message (see [Releasing](releasing.md)) |

Link every new page under `docs/` from [docs/README.md](../README.md).
`test/docs-structure.test.ts` fails when a page is unreachable.

### Page shapes

- **Guide.** Start with `# <Task, in the imperative>` and one or two sentences
  on what it achieves and for whom. Then `## Before you start`, listing
  prerequisites. Give each step a section with the command, the expected
  result and how to verify it. End with `## See also`.
- **Reference.** Tables first. Add one short sentence per entry where a cell is
  not enough. No advice, no narrative.
- **Troubleshooting entry.** A `###` heading quoting what the user sees, then
  **Cause.**, **Fix.**, and optionally a *Background* link to a decision
  record.
- **Explanation.** Short paragraphs about mechanisms and trade-offs. It may
  summarize several decision records and link them.

## Decision records

A decision record (ADR) holds one decision. The index, the template and the
list of existing records are in
[docs/decisions/README.md](../decisions/README.md).

### When to write one

Write a record when:

- A change settles a design question with real alternatives, or accepts a cost
  on purpose.
- A rule exists because something happened (a bug, a measurement, a failure in
  a live deployment), and without that story the rule would look arbitrary.
- Someone could plausibly "fix" the current behaviour straight back into the
  original problem.
- A change reverses or narrows an earlier record.

Don't write one for what changed in a release (that goes in `CHANGELOG.md`),
for how to do something (a guide), or for a list of options (reference).

### Add a record

1. Take the next free number. Records are numbered from `0001`, with no gaps
   and no repeats. Name the file `NNNN-short-slug.md`.
2. Copy the template from [docs/decisions/README.md](../decisions/README.md).
   The title line is `# NNNN. <the decision, stated as a sentence>`, followed
   by a `- **Status:**` line, a `- **Date:** YYYY-MM-DD` line and an
   `- **Area:**` line.
3. Under **Context**, write what forced the decision: the problem, the facts,
   the numbers, what happened. This is where the story lives. Keep it terse.
4. Under **Decision**, state the rule in a form that can be checked.
5. Under **Consequences**, list the costs accepted, what not to do, and what
   evidence would reopen the question.
6. Optionally add **Related** links to specs, code and other records.
7. Add the record to the index in `docs/decisions/README.md`, under its area,
   in the same change. `test/docs-structure.test.ts` checks the numbering, the
   title, `Status`, `Date` and the index entry.

### Status values

The index in `docs/decisions/README.md` is the authority for these.

| Status | Meaning |
|---|---|
| `Accepted` | In force. |
| `Proposed` | A settled shape for work that is not built yet. |
| `Superseded by [NNNN](NNNN-slug.md)` | Replaced by a later record; kept for history. |

### Change a decision

Don't rewrite an accepted record. Write a new record that states the new rule
and links the old one. Then change only the old record's status line, to
`Superseded by [NNNN](NNNN-slug.md)`. Fixing a typo or a broken link in place is
fine.

## Style rules

1. Write in English, in plain and direct sentences. Guides and reference pages
   prefer lists and tables to paragraphs.
2. Write procedures in the imperative: the command, the expected result, how to
   verify. Put commands in fenced `bash` blocks, one command per line where
   practical, without `$` prompts.
3. Keep a warning to one sentence stating the rule and its consequence, in a
   `> [!WARNING]` or `> [!NOTE]` block, used sparingly. Give the reason as a
   link to a decision record or an explanation page, never as a retold
   incident.
4. Index troubleshooting by what the user sees, not by cause.
5. Check every factual claim against the code, compose files, scripts,
   workflows or git history. Don't copy a claim from another page without
   checking it.
6. Cite roadmap phases by number only in `docs/spec/06-roadmap.md`, decision
   records, `CHANGELOG.md` and tag messages. Everywhere else, say what the work
   is and link the roadmap. A number in a claim about history stays true when
   the roadmap is reordered; a forward reference does not.
   `test/phase-citations.test.ts` enforces this for `src/`, the specs and the
   pages that describe the present.
7. Don't write numbers that rot: test counts, prompt file sizes, line counts. A
   decision record may record a measurement, with its date.
8. Use relative links for in-repo targets, and make sure they resolve, anchors
   included. `test/docs-links.test.ts` applies GitHub's slug rules: lowercase,
   punctuation dropped, spaces become hyphens, backticks removed. From a
   subfolder of `docs/`, link code as
   `[src/core/config.ts](../../src/core/config.ts)`.
9. Never cite `CLAUDE.md` or its sections. Cite `docs/decisions/`, `docs/spec/`
   or `docs/development/` instead.
10. Treat the specs as the authority. When a guide and a spec disagree, fix the
    guide, or change the spec on purpose in its own right.
11. When a capability changes, re-read the *Status* section of `README.md` and
    `docs/getting-started.md`, and ask whether any sentence there is now
    untrue. Every other page is updated by the change that owns it, but nothing
    owns these two.

## A correction states the rule

When a bug or an incident teaches something, the page that guides the reader
gets the rule, in a sentence or two. The story goes in the **Context** of a
decision record, and the page links to it. The story covers what happened, how
it was found, what it cost and the numbers measured.

This applies with extra force to the agent prompt, which is loaded on every
turn. Each paragraph of "this happened once" is reasonable on its own, but the
growth only shows in aggregate. The size budget in
`test/agent-skill.test.ts` exists for that reason (see
[Agent prompt tests](testing.md#agent-prompt-tests)).

## The deployed agent prompt

`agent/workspace/` and `agent/skills/` are deployed to the gateway and read by
the model, not by maintainers.

- **Audience.** They address the model. They never cite a repository path such
  as `docs/…`, `src/…` or `test/…`. The deployed copies don't live in a
  checkout, so a cited path is at best inert and at worst an invitation to a
  failed read. If a rule needs its reason written down, the reason goes in
  [Agent design](../explanation/agent-design.md) or a decision record.
- **Language.** They are English only, with no phrasebook of utterances in
  other languages. The agent gets localized words from `gamereg vocab` at run
  time.
- **Tests.** They are size- and content-tested; see
  [Agent prompt tests](testing.md#agent-prompt-tests). Before you add text to
  `agent/workspace/`, which is loaded on every turn, check whether it belongs
  in a `reference/` file under `agent/skills/gamereg/`, which is read only when
  its flow happens.
- **Personas.** `agent/PERSONAS.md` is not deployed. When it and
  `agent/workspace/SOUL.md` disagree, `SOUL.md` wins.

## Language

Everything the repository writes is in English: code, comments, docs, commit
messages, issues and the agent prompt. Example utterances in the specs show how
a message maps to an invocation. They make no claim about which language a user
speaks.

Another language may appear only as data:

- `i18n/*.json`
- the *Command name mapping (pt-BR)* table in
  [02-cli.md](../spec/02-cli.md#command-name-mapping-pt-br)
- the fictional user content in `example-vault/`
- `Pokémon`, a Unicode-normalization fixture in `03-resolution.md` and
  `test/normalize.test.ts`
- a user's message quoted in a doc as an example input, such as a reply the
  agent has to interpret; it shows a mapping, not the language of the page
- the maintainer's Portuguese section in `README.md`, inside its human-owned
  region

A term is written down once, in `i18n/`. Don't add a glossary or a per-language
copy of it anywhere else.

## Protected regions

Text between `<!-- human-owned -->` and `<!-- /human-owned -->`, in any file, is
written by the maintainer by hand. Automated and AI-assisted sessions never
edit, reword, move or delete it. That holds even as a side effect of a larger
edit to the same file. If a change seems to need it, stop and ask. No tooling
enforces the markers, so this rule is the only protection they have.
`README.md` holds such a region.
