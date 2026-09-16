**What this changes and why**

**Checklist**

- [ ] `npm run typecheck` and `npm test` pass (no network needed)
- [ ] `npm run test:live` run, if this touches `normalize()`,
      `findDetail`/`enrichGame`, or `providers/igdb.ts`'s `search`/`fetch`
- [ ] New or changed behavior has a test, and output changes under
      `src/render/` or `src/targets/` update the golden files in
      `example-vault/` (see `docs/development/testing.md`)
- [ ] The spec for any changed behavior is updated, and `README.md`'s *Status*
      and `docs/getting-started.md` are still true (see
      `docs/development/documentation.md`)
- [ ] `CHANGELOG.md` has a one-line entry under `[Unreleased]`, if this is
      user-visible
- [ ] No hardcoded English added to `src/` outside `src/core/platforms.ts`
- [ ] Doesn't break an invariant in `docs/spec/00-architecture.md` or go
      against a record in `docs/decisions/`, or proposes superseding it and
      says why above
- [ ] Doesn't change `version` in `package.json` or create a git tag (see
      `docs/development/releasing.md`)

**Related issue**

Closes #
