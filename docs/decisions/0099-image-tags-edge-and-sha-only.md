# 0099. The image is published as :edge and :sha tags only, with no :latest before 1.0.0

- **Status:** Accepted
- **Date:** 2026-09-13
- **Area:** Versioning and releases

## Context

Publishing a container image is a promise about stability. `:latest` reads as "safe to depend on" to someone who was never told this is a preview, and that claim belongs to a version number the project has not published yet. At the same time, an installation needs a way to stop a restart from changing what runs.

## Decision

CI publishes from `main` only, and only after the verify job passes: `:edge`, which moves with `main`, and `:sha-<commit>`, which never moves. No `:latest` before 1.0.0. The tag is a variable in `compose.yml`, so pinning or rolling back never means editing the file.

## Consequences

A running stack keeps the image it started with until someone pulls, which is worth saying in the guide because `up -d` alone looks like an upgrade and is not.

Rolling back is setting `GAMEREG_IMAGE_TAG` to a `sha-` tag.

How image tags will map to released versions is still undecided; it is decided when there is a release to map.

## Related

- .github/workflows/image.yml header and publish job
- git show main:docs/deploy-container.md "Which image"
