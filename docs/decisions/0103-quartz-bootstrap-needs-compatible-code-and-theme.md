# 0103. Quartz bootstrap needs compatible framework code and a declared theme

- **Status:** Accepted
- **Date:** 2026-09-22
- **Area:** Site and comments

## Context

The publishing guide selected the `v5.0.0` tag. Its plugin loader interprets
npm sources as Git repositories: `@quartz-community/content-page` becomes
`https://github.com/@quartz-community/content-page.git`. A working personal
vault has later framework code that supports npm, although both package files
report `5.0.0`. The tag and the later implementation are not interchangeable.

Changing every seed source to Git and disabling plugins addressed the wrong
boundary. Git checkouts can lack built entry points. Independently, a clean
upstream installation lacks the package named by `@quartz-themes/core`'s
`theme` option. The theme loader then invokes npm during emission; an existing
vault with that theme already installed conceals the missing prerequisite.

A temporary copy of the working framework built the example content with npm
sources. Removing only its default theme reproduced the mid-build installation.
Current upstream at `97a2d05f80c4c50534959b1d0d41cc4b3895625e` also omits that
theme from its dependencies. The personal vault was consulted read-only.

## Decision

Keep npm sources in the seeded config, and document the requirement for a
Quartz v5 checkout with npm plugin support instead of prescribing the old tag.
Disable the unavailable Excalidraw plugin in the seed; gamereg emits no
Excalidraw content.

Before npm installation, parse the vault's YAML and declare the enabled theme's
package in the merged package manifest. Variations use their base package.
Preserve existing constraints; otherwise npm resolves the published version and
records it in the generated lockfile. Use the existing YAML parser, not a regex
that depends on indentation, quoting or property order.

## Consequences

A fresh vault no longer depends on a previous build having installed its theme.
The vendor script requires gamereg's dependencies to be installed. Config and
content remain user-owned during vendoring. Offline tests cover dependency
preparation, while a real Quartz build remains a manual integration check.

## Related

- [0054](0054-vendored-quartz-config.md)
- [Publishing](../guides/publish-site.md)
- [Vendor script](../../scripts/vendor-quartz.sh)
