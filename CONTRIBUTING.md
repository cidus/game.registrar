# Contributing

The Registrar is a personal project, kept open in case it is useful to someone
else. Issues and pull requests are welcome, and reviews happen when the
maintainer has time. A change that conflicts with a recorded decision will
probably be declined, unless it makes the case for reopening that decision.

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities
privately, as described in [SECURITY.md](SECURITY.md).

## Before you start

1. Read [docs/spec/00-architecture.md](docs/spec/00-architecture.md) for the
   decisions, non-goals and invariants, then
   [docs/spec/01-model.md](docs/spec/01-model.md) for the data model. Those two
   constrain everything else.
2. If your change touches `gamereg build`, also read
   [docs/spec/07-targets.md](docs/spec/07-targets.md). The build is a registry
   of targets, not a single emitter.
3. Before you propose changing something that looks arbitrary, check
   [docs/decisions/README.md](docs/decisions/README.md). Many records say what
   evidence would reopen them.
4. Keep the [invariants](docs/spec/00-architecture.md#invariants) intact. If a
   change seems to need breaking one, open an issue before writing code.

Open an issue and agree on the approach before writing code for any of these:

- a schema change to [01-model.md](docs/spec/01-model.md), such as a new event
  type or payload field
- a new build target, or a target that reads anything other than the folded
  state and the config
- a runtime dependency beyond the [stack](docs/spec/00-architecture.md#stack)
- anything that writes outside the vault root

## Development setup

You need Node.js 22.18 or later, npm, git and `sh`. The tests run TypeScript
through Node's built-in type stripping, which works without a flag only from
22.18.

```bash
git clone https://github.com/cidus/game.registrar.git
cd game.registrar
npm install
node src/cli/main.ts --version
```

`npm install` also compiles `dist/` through the `prepare` script. The last
command runs the CLI straight from source. If you use the compiled binary
instead (for example through `npm link`), run `npm run build` after every change
to `src/`, or it keeps running the old code. Point `--vault` at a scratch
directory, and don't build `example-vault/` in place: it is the golden fixture.

Run these before opening a pull request:

```bash
npm run typecheck
npm test
```

`npm run typecheck` runs `tsc --noEmit` over `src/` and `test/`. `npm test` runs
every `test/**/*.test.ts` file with `node:test`, and needs no network and no
credentials.

`npm run test:live` is opt-in. It calls the real IGDB API and skips cleanly
without credentials. Run it whenever you touch `normalize()`,
`findDetail`/`enrichGame`, or `search`/`fetch` in `providers/igdb.ts`: a green
`npm test` doesn't show that matching still works against the real catalog.
[Live tests](docs/development/testing.md#live-tests) says where the credentials
come from.

### Build the container image from a checkout

`compose.yml` pulls the published image. To build from your checkout instead,
add `compose.build.yml`. Fill in `.env` first, as described in
[Deploy with containers](docs/guides/deploy-container.md).

```bash
cp .env.example .env
docker compose -f compose.yml -f compose.build.yml build
docker compose -f compose.yml -f compose.build.yml up -d
```

The local build takes the image name and tag the stack would otherwise pull
(`GAMEREG_IMAGE_TAG`), so it replaces that image.

## Repository layout

```
.
├── src/                 the CLI
│   ├── cli/             commander wiring, output and prompts; one file per command in commands/
│   ├── core/            events, fold, durations, time, check-in triggers, vocab, config,
│   │                    platforms, secrets, errors, ids, vault paths
│   ├── resolve/         title normalization and candidate resolution
│   ├── render/          Markdown and SVG emitters, marker splicing, flavours, year in review
│   ├── targets/         registry, build, manifest, writer, audit, lock, asset mirror;
│   │                    one file per target
│   ├── db/              SQLite schema, database build, query guard
│   ├── providers/       provider interface and registry, igdb.ts
│   ├── images/          photo ingest pipeline, EXIF
│   └── i18n/            locale bundle loader
├── i18n/                locale bundles (en.json, pt-BR.json), shipped with the package
├── templates/           files seeded into a vault: Game Database.base, quartz.config.yaml
├── example-vault/       golden fixture: a fictional event log and the expected output of every target
├── test/                node:test suites, helpers.ts, dump-db.ts; live/ holds the opt-in IGDB tests
├── agent/               chat agent: workspace/ and skills/ (the deployed prompt), checkin.sh,
│                        config examples
├── docker/              container entrypoint, maintenance loop, site build loop
├── scripts/             autobuild.sh and its systemd units, vendor-quartz.sh
├── docs/                documentation; the map is docs/README.md
│   ├── getting-started.md
│   ├── guides/          how-to guides and troubleshooting
│   ├── reference/       configuration, environment, container
│   ├── explanation/     how it works, agent design, security
│   ├── spec/            the normative specification
│   ├── decisions/       architecture decision records
│   └── development/     testing, releasing, documentation
├── .github/             workflows/ (test, image, live), issue and pull request templates
├── .claude/             agent definitions for AI coding sessions
├── dist/                compiled output, not committed
├── Dockerfile, compose.yml, compose.build.yml, .env.example
└── README.md, CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, CLAUDE.md, LICENSE
```

`render/` produces strings. `targets/` decides which files exist, each with a
write policy (`replace`, `splice` or `seed`), and the writer applies them to
disk. A target reads only the folded state and the config (invariant 8).

## Conventions

- **TypeScript.** ESM on Node.js 22.18 or later, with `strict: true` and
  `noUncheckedIndexedAccess`. No `any` in `src/core/`.
- **Errors.** Use the one error class, `GameregError` in
  [src/core/errors.ts](src/core/errors.ts). Its `code` is an exit code from
  [02-cli.md](docs/spec/02-cli.md#exit-codes). It carries an i18n key and
  parameters, and the output layer renders the message. Exit code 6
  (`provider_unavailable`) means the local work was still committed.
- **User-facing strings** come from `i18n/`, error messages included. The one
  exception is [src/core/platforms.ts](src/core/platforms.ts), which holds
  platform names and the catalogs' own spellings as data.
- **Persona.** The agent's persona belongs to prose output only. JSON output
  and event payloads stay neutral.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/),
  in English.
- **English only.** Code, comments, docs, commit messages, issues and the agent
  prompt are in English. Another language appears only as data:
  - `i18n/*.json`
  - the *Command name mapping (pt-BR)* table in
    [02-cli.md](docs/spec/02-cli.md#command-name-mapping-pt-br)
  - the fictional user content in `example-vault/`
  - `Pokémon`, a Unicode-normalization fixture in `03-resolution.md` and
    `test/normalize.test.ts`
  - a user's message quoted in a doc as an example input
  - the maintainer's Portuguese section in `README.md`, inside its
    `<!-- human-owned -->` region
- **Protected regions.** Text between `<!-- human-owned -->` and
  `<!-- /human-owned -->` is the maintainer's own. Don't change it without
  asking first.

## Documentation

- [docs/development/documentation.md](docs/development/documentation.md) says
  where a new page belongs and gives the style rules.
- A change that adds, removes or alters a capability updates the spec it
  implements and `CHANGELOG.md`. Then re-read the *Status* section of
  [README.md](README.md) and [docs/getting-started.md](docs/getting-started.md),
  and ask whether any sentence there is now untrue. No change owns those two
  pages, so they go stale first.
- `npm test` checks the documentation too: links and anchors, the documentation
  map, decision record numbering and phase citations. See
  [Documentation tests](docs/development/testing.md#documentation-tests).

## Pull requests

- **Scope.** Keep each pull request to one concern. A bug fix doesn't need
  surrounding cleanup.
- **Tests.** Add or update tests for what you change. If a change under
  `src/render/` or `src/targets/` alters output, update the golden files in
  `example-vault/` in the same pull request (see
  [Golden files](docs/development/testing.md#golden-files)).
- **CI.** Both workflows that run on a pull request must pass:
  - `test` runs `npm run typecheck` and `npm test` on Node.js 22.18 and 24.
  - `image` builds the container image, runs `gamereg --version` and the
    entrypoint's `--dry-run` in it, and compares a clean-room build of
    `example-vault/` with the committed goldens.
- **Changelog.** If users can see the change, add one line under
  `## [Unreleased]` in `CHANGELOG.md`, under the matching heading: `Added`,
  `Changed`, `Deprecated`, `Removed`, `Fixed` or `Security`. Say what changed;
  the reasoning belongs in the pull request or a decision record.
- **Decisions.** If the change settles a design question or reverses a recorded
  decision, add a decision record or supersede the old one (see
  [Decision records](docs/development/documentation.md#decision-records)).
- **Versions.** Don't bump `version` in `package.json` or create tags. The
  maintainer makes releases, as described in
  [Releasing](docs/development/releasing.md).
