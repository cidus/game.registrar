# 0036. The site is built off-box by default

- **Status:** Accepted
- **Date:** 2026-08-22
- **Area:** Site and comments

## Context

The `quartz` target emits quartz/content/ and a seeded quartz.config.yaml; running Quartz is left to the user. Phase 3 shipped no GitHub Actions workflow although 06-roadmap.md lists one. Two reasons were given for leaving it open: documenting a workflow satisfies the roadmap bullet as well as shipping one would, and 'how this runs on a host' is phase 4's question, so deciding it in two phases risks two conflicting answers. Nothing is stranded because quartz/content/ is committed. Since then the container answered hosting but not the build. The default topology builds the site off-box, because an e2-micro has 1 GB RAM against a Quartz build's 400-700 MB peak and 1 GB of egress a month against a vault's cover art, and the vault is already pushed by autobuild.sh. and is not built yet'. scripts/vendor-quartz.sh is described as a manual recipe run against a real vault and a real Cloudflare Workers deploy, not the phase-4 answer.

What changed since: compose.yml:155 site-build with profiles [site],:187 site-serve caddy:2-alpine. site-loop.sh:145-202 watches git HEAD and builds in /cache. The test asserts byProfile('site') equals ['site-build','site-serve'] (entrypoint-wrapper.test.ts:727). `git log -S 'and is not built yet' -- the project's working notes` gives 5cd9197 (2026-09-01), the same day the profile landed in 9eddb6c, and the text was never updated. .github/workflows has no Quartz job. 07-targets.md:305 'How the site is built from there is the user's business: by hand, from CI, from a cron job.'.

## Decision

gamereg never runs Quartz; it emits Quartz's input and stops. The default is to build off-box from the repository the maintenance loop pushes (a GitHub Action, or Cloudflare building on push). A local `site` profile (Quartz build loop plus Caddy) serves installations with no external account.

## Consequences

The item is largely answered and should not stay under Open items. The local site profile IS built: compose.yml:155-207 (site-build, site-serve), docker/site-loop.sh, entrypoint.sh:723-726 'site' mode, commits 9eddb6c (2026-09-01) and d55c1aa (2026-09-02), and test/entrypoint-wrapper.test.ts:712-734 pins the profile set. The off-box path is documented (docs/deploy-container.md:180-188) and in production (README.md:53, site built on a Cloudflare Worker from a private GitHub repo). What remains true: no shipped workflow builds Quartz (.github/workflows has only image.yml, live.yml, test.yml), while the 06-roadmap.md:61 bullet still says 'GitHub Action on push'. The phase-3 exit criterion accepts hand publishing via vendor-quartz.sh (06-roadmap.md:79-83).

## Related

- [compose.yml](../../compose.yml)
- [docker/site-loop.sh](../../docker/site-loop.sh)
- [scripts/vendor-quartz.sh](../../scripts/vendor-quartz.sh)
- [docs/guides/deploy-container.md](../guides/deploy-container.md)
- [docs/spec/07-targets.md](../spec/07-targets.md)
- [docs/spec/06-roadmap.md](../spec/06-roadmap.md)
- .github/workflows
- [test/entrypoint-wrapper.test.ts](../../test/entrypoint-wrapper.test.ts)
- docs/deploy-container.md:181-187 (git show main:)
