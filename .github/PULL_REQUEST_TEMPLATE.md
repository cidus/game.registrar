**What this changes and why**

**Checklist**

- [ ] `npm test` passes (388+ tests, no network)
- [ ] `npm run test:live` run, if this touches `normalize()`,
      `findDetail`/`enrichGame`, or `providers/igdb.ts`
- [ ] New/changed behavior has a test — golden file update for anything under
      `render/` or `targets/`
- [ ] `CHANGELOG.md`'s `[Unreleased]` section has an entry, if this is
      user-visible
- [ ] No hardcoded English added to `src/` outside the documented exceptions
      (`core/platforms.ts`) — see `CLAUDE.md`'s *Language* section
- [ ] Doesn't touch `package.json`'s `version` or create a git tag (that's
      maintainer-triggered, see `CLAUDE.md`'s *Versioning* section)

**Related issue**

Closes #
