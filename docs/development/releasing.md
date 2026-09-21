# Releasing

This page covers how versions are numbered, how a release is cut, and what CI
publishes. Releases are the maintainer's job: don't bump versions, create tags
or push tags unless the maintainer asks you to.

## Version numbers

The project follows [SemVer](https://semver.org/), with versions tied to the
delivery phases in the [roadmap](../spec/06-roadmap.md) rather than to
individual features.

| Version | Meaning |
|---|---|
| `0.Y.0` | A numbered roadmap phase before the installable release. `0.0.0`, `0.1.0`, `0.2.0` and `0.3.0` are these. |
| `1.0.0` | The last numbered phase, the one that makes the tool installable on someone else's machine. It is the version that tells a stranger the contracts are safe to depend on. |
| `1.Y.0` and later minors | Work listed under [After 1.0](../spec/06-roadmap.md#after-10) in the roadmap, such as board games. |
| `X.Y.Z` with `Z` > 0 | A bug fix to an already-tagged release. |
| `X.Y.Z-dev` | The development window for the next release. `package.json` carries it on every commit except the one that gets tagged. |

`gamereg --version` prints the version from `package.json`, so a `-dev` suffix
shows that a binary is not a tagged release.

Tying versions to phases makes a release a statement that a phase is done, not
a feature count. `1.0.0` goes to the installable phase because installability
and a stable contract are the same promise to the same reader. Board games come
after it, so a second category of game cannot hold that release back. The
`-dev` suffix replaced bumping to the next plain version ahead of its tag,
which let `--version` claim a release that had not happened. The decisions
behind this scheme are indexed in [docs/decisions/](../decisions/README.md).

## Before you release

- The work is merged on `main` and CI is green. Tag a phase only once it is
  actually done.
- The `## [Unreleased]` section of `CHANGELOG.md` covers every user-visible
  change since the previous tag.
- The *Status* section of `README.md` and `docs/getting-started.md` are true
  for this release.

## Cut a release

In the steps below, `X.Y.Z` is the new version and `vP.Q.R` is the previous
tag.

1. Drop the `-dev` suffix. `npm version` updates `package.json` and
   `package-lock.json` together:

   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```

2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and
   add a new, empty `## [Unreleased]` above it. Group the section's entries
   once per heading, in Keep a Changelog order: Added, Changed, Deprecated,
   Removed, Fixed, Security.

3. Update the link reference definitions at the bottom of `CHANGELOG.md`:
   point `[Unreleased]` at the new tag and add a line for the new version
   above the previous one.

   ```
   [Unreleased]: https://github.com/cidus/game.registrar/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/cidus/game.registrar/compare/vP.Q.R...vX.Y.Z
   ```

4. Commit the three files together. This commit is the release:

   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore(release): X.Y.Z"
   ```

5. Create an annotated tag on that commit. The tag message is the narrative
   version: why the release happened and what it proved, written as prose.
   `git tag -n99 v0.2.0` shows the shape. The GitHub release does not show it.

   ```bash
   git tag -a vX.Y.Z -F tag-message.txt
   ```

6. Open the next development window in a separate commit. After a major or
   minor release, that is the next minor version with `-dev`. After `1.0.0`,
   for example:

   ```bash
   npm version 1.1.0-dev --no-git-tag-version
   git add package.json package-lock.json
   git commit -m "chore(release): open the 1.1.0 window"
   ```

   After a patch release, restore the `-dev` version that was open before the
   patch.

7. Push the commits and the tag:

   ```bash
   git push
   git push --tags
   ```

8. Create the GitHub release. Its body is this version's section of
   `CHANGELOG.md` and nothing else: the lines under `## [X.Y.Z]`, without the
   heading.

   ```bash
   awk '/^## \[X\.Y\.Z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md > notes.md
   gh release create vX.Y.Z --title "vX.Y.Z — <summary>" --notes-file notes.md
   ```

   Don't use `--notes-from-tag`. It publishes the tag's narrative where every
   other release shows the changelog section.

9. If you are creating releases for several existing tags at once, create them
   oldest first. GitHub marks the most recently created release as *Latest*.

## Container images

[.github/workflows/image.yml](../../.github/workflows/image.yml) publishes the
image today as follows:

- **When.** Only pushes to `main` publish, and only after the `verify` job
  passes. Pull requests build and verify the image but publish nothing.
- **What.** `ghcr.io/cidus/gamereg`, built on native runners for `linux/amd64`
  and `linux/arm64` and joined under one multi-arch manifest. Provenance
  attestations are turned off.
- **Tags.** Each push gets two:
  - `:edge` moves with `main`.
  - `:sha-<first 7 characters of the commit>` never moves. A deployment can
    pin it, and a rollback returns to it.
- **Not published.** There is no `:latest` tag and no version tag. The
  workflow holds `:latest` back because it is the tag that reads as safe to
  depend on.

`compose.yml` pulls `:edge` unless `GAMEREG_IMAGE_TAG` names another tag; see
[Deploy with containers](../guides/deploy-container.md).

Version tags for images are not defined yet. The release steps above don't
publish, tag or promote an image, and no process connects a git tag to an
image tag.

## Known irregularities

This history doesn't follow the procedure above. It is already pushed, so it is
recorded here rather than rewritten.

- **`v0.3.0` carries a `-dev` version.** The tag points at commit `4470a25`,
  whose `package.json` and `package-lock.json` read `0.3.0-dev`, so a binary
  built from it reports `0.3.0-dev`. The tag was placed afterwards, on the last
  commit before the container work, and the commits after it kept `0.3.0-dev`
  until the `1.0.0-dev` window was opened.
- **The `0.3.0` release missed the changelog links.** No `[0.3.0]` link
  definition was added to `CHANGELOG.md`, and `[Unreleased]` kept comparing
  from `v0.2.0`. Both were corrected later.
- **Released sections carry titles, not dates.** Each heading from `0.0.0` to
  `0.3.0` has a title after the version instead of a date, and stays as
  released.
- **Early releases predate `-dev`.** `package.json` was bumped to the next
  plain version ahead of each tag. It went to `0.2.0` right after `v0.1.0`,
  down to `0.1.1` and later `0.1.2` for the two patches and back up each time,
  through `0.1.3` (never released), and to a plain `0.3.0` until `0.3.0-dev`
  replaced it.
