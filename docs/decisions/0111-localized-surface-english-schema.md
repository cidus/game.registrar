# 0111. The vault's surface is localized; its schema, its queries and its seeds' filenames are not

- **Status:** Accepted
- **Date:** 2026-09-24
- **Area:** Build and targets

## Context

D7 has said since the beginning that the schema is English and the interface is
localized, and `01-model.md` says it again for vocabularies: "Stored values are
the English tokens below. Display labels come from `i18n/<locale>.json`." The
mechanism existed too — `Translator.label()`, with pt-BR complete for every
enum group.

The generated notes only half obeyed. In a pt-BR vault the column header read
**Dificuldade** and the cell under it read `hard`; the Obsidian sidebar showed
**Game List** while the `H1` inside that same file read **Jogos**; the seeded
`Game Database.base` offered views named *Finished* and *Playing*; and the
seeded `quartz.config.yaml` carried `locale: en-US`, which puts Quartz's own
interface into English on a Portuguese register.

None of that was decided. Three render call sites simply never called `label()`,
and the two shipped templates were loaded verbatim with no way to say anything
else. But fixing it needs a rule, because "translate the notes" is wrong: some
of those strings are read back by something.

## Decision

**A token is localized when it is prose in a cell, and never when something
queries it.** The Difficulty and Criteria columns of the consolidated table and
of the game note's runs table print `bundle.label(...)`. The frontmatter beside
them keeps `difficulty: hard`, `completion_criteria: true_ending`,
`status: finished` — that is what `Game Database.base` filters on, what
`gamereg query` mirrors, and what the CSV headers and SQLite columns are named
after. The same rule sends folder names, tags, property names and slugs to the
English side: they are all link targets or query surfaces.

**A shipped template is a literal with named holes**, `{{base.view.finished}}`,
resolved when the file is planned. There is no per-locale copy of a template
and there must not be: a second structural copy is the drift ADR 0019 records,
and a view added to the English one would silently not exist in the others. A
hole is filled with a **serialized YAML scalar**, never pasted raw, because
both templates are YAML and a translation carrying `: ` or spelling a YAML 1.1
boolean would corrupt a file that is written once and never repaired. An
unfillable hole is a **hard error** for the same reason.

**A filename may be localized only for a `replace` or `splice` artifact, never
for a seed.** `obsidian/Game List.md` and `obsidian/Stats.md` move with the
locale; `Game Database.base` and `quartz.config.yaml` do not. The build removes
a path a target no longer plans, which is what makes the first pair safe — and
it never removes a seed, so a localized seed name would leave the user holding
two of them. Nothing under `quartz/content/` moves either: those paths are
wikilink targets, kept stable by ADR 0052.

## Consequences

**The same run now reads two ways in one vault, and that is the accepted
price.** `Lista de Jogos.md` says `final verdadeiro`; the Bases view, which
reads frontmatter, says `true_ending`. Obsidian Bases has `displayName` for a
column and no mapping for a value, so closing that gap would mean translating
the frontmatter — which would empty every filter in the `.base` and break
`gamereg query`. The asymmetry stays.

**Renaming a note discards prose outside its markers**, once, on the build
after a locale changes. Both files are `splice`, so a user may have written
there; the build removes the old path and writes the new one from nothing. It
is done pre-`1.0.0` deliberately, and `configuration.md` warns.

**`locale` is now an input to the build's path set, not only to its bytes.** Any
test that builds a vault declaring no locale takes the developer's `LANG`;
`test/autobuild-wrapper.test.ts` did, and now pins `en` the way
`test/cli.test.ts` already did.

**The seeds are localized at first write and never again.** A vault that
changes locale later keeps the seeds it has. Deleting them and rebuilding is
the refresh path — a seed is written when absent, so `--force`, which would
also overwrite every other seed the user has edited, is not needed.

**English output moved by two words**: `true_ending` and `full_completion` are
labels too, and read `true ending` and `full completion` now. `Game List.md`'s
`H1` changed from `Games` to `Game List`, because the filename and the heading
inside it are now one key — they had drifted apart, which is what a second key
for one idea does.

**The `html` target still prints raw tokens in its visible cells**
(`src/targets/html.ts`), while its headers are already localized. Out of scope
here; `07-targets.md` now describes what the code does rather than claiming the
gap is closed.

## Related

- [docs/spec/00-architecture.md](../spec/00-architecture.md) — D7
- [docs/spec/01-model.md](../spec/01-model.md) — *Controlled vocabularies*
- [docs/spec/04-derived.md](../spec/04-derived.md) — the consolidated table, Determinism
- [docs/spec/07-targets.md](../spec/07-targets.md) — target rule 3, write policies
- [ADR 0019](0019-agent-gets-words-not-sentences.md) — one place a term is written down
- [ADR 0010](0010-platform-names-are-data.md) — the one deliberate exception to the i18n rule
- [ADR 0052](0052-site-wikilinks-name-the-folder.md) — why site paths stay stable
- [ADR 0053](0053-front-page-names.md) — why the vault's front page is named what it is
- [src/targets/templates.ts](../../src/targets/templates.ts)
- [test/localization.test.ts](../../test/localization.test.ts), [test/templates.test.ts](../../test/templates.test.ts)
