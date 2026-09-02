# Contributing

This is a personal project, kept open in case it's useful to someone else.
Issues and PRs are welcome, but read `CLAUDE.md` first — it holds the
decisions that would otherwise get re-litigated in review, and the
non-negotiables a change is expected to respect.

## Before you start

1. Read `docs/spec/00-architecture.md` (decisions and invariants), then
   `docs/spec/01-model.md` (the data model). Those two constrain everything
   else. Touching `build`? Add `docs/spec/07-targets.md` — the build is a
   registry of targets, not a single emitter.
2. Read `CLAUDE.md`'s *Decisions worth not re-litigating* and *Non-negotiables*
   sections. If your change seems to require breaking one of the
   non-negotiables, open an issue to discuss it before writing code.
3. For anything under `agent/`, `agent/README.md` is the deployment log — it
   documents real operational failure modes from running this live.

## Setup

```bash
npm install     # builds via the prepare script; no separate build step
npm test        # 397 tests, node --test, no network
```

`npm run test:live` is opt-in and needs real IGDB credentials — it skips
cleanly without them. Run it whenever you touch `normalize()`,
`findDetail`/`enrichGame`, or `providers/igdb.ts`'s `search`/`fetch`: a green
`npm test` does not mean matching still works against a real catalog.

## Testing strategy

Golden files (`example-vault/`) are the primary tool — a build target with no
golden file is not done. See `CLAUDE.md`'s *Testing strategy* section for the
full list of properties every change is expected to hold (idempotency,
ownership, preservation of hand-written prose, fold correctness, and so on).

## Conventions

- TypeScript, ESM, Node 22+. `strict: true`, no `any` in `core/`.
- All user-facing strings come from `i18n/`. No hardcoded English in `src/`
  (see `CLAUDE.md`'s *Language* section for the narrow, deliberate
  exceptions).
- Commit messages: [Conventional Commits](https://www.conventionalcommits.org/),
  English.
- Everything the repository writes — code, comments, docs, commit messages,
  issues — is in English.

## Pull requests

- Keep changes scoped to one concern; a bug fix doesn't need surrounding
  cleanup.
- Add or update tests for anything you change — no PR merges without a green
  `npm test`.
- If your change is user-visible, add an entry under `[Unreleased]` in
  `CHANGELOG.md` (Keep a Changelog format — one line, in `Added`/`Changed`/
  `Fixed`/`Removed`).
- Versioning and tagging are maintainer-triggered (see `CLAUDE.md`'s
  *Versioning* section) — don't bump `package.json` or tag a release in a
  contribution PR.
