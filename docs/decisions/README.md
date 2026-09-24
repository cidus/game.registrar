# Decision records

One file per decision: the context that forced it, the rule adopted, and what it
costs. These are Architecture Decision Records (ADRs). They exist so that a
settled question is not re-litigated, and so that the story of how a rule was
found lives here instead of inside a guide.

The foundational decisions (D1 to D9: the append-only event log, the CLI as the
only writer, the build as a registry of targets, and the rest) are part of the
architecture specification, in
[00-architecture](../spec/00-architecture.md#decisions), together with the
invariants they protect. They are not repeated here.

## Using this log

- **Before changing a decided area**, read its records below. Most exist because
  the obvious alternative was tried or considered and cost something.
- **To record a decision**, copy the template into `NNNN-short-slug.md` with the
  next free number, and add it to the index and to its area. The conventions are
  in [documentation.md](../development/documentation.md).
- **When a decision changes**, write a new record and mark the old one
  `Superseded by [NNNN](NNNN-slug.md)`. A record is not rewritten after the fact.
- **Status** is `Accepted`, `Proposed` (a settled shape for work not built
  yet), or `Superseded`.

## Template

~~~markdown
# NNNN. <The decision, stated as a sentence>

- **Status:** Accepted
- **Date:** YYYY-MM-DD
- **Area:** <area>

## Context

What forced a decision: the problem, the facts and numbers, what was tried.

## Decision

The rule, stated so it can be checked.

## Consequences

Costs accepted, what not to do instead, what evidence would reopen it.

## Related

Links to specs, code and other records.
~~~

## Index

| # | Decision | Area | Status | Date |
|---|---|---|---|---|
| [0001](0001-run-notes-written-whole.md) | Run notes are written whole; game notes are spliced | Build and targets | Accepted | 2026-08-12 |
| [0002](0002-chase-has-its-own-slot.md) | The morning chase has its own delivery slot, separate from day_cutoff | Check-ins | Accepted | 2026-08-12 |
| [0003](0003-bases-not-dataview.md) | Obsidian Bases are supported; Dataview is not | Build and targets | Accepted | 2026-08-12 |
| [0004](0004-provider-ambiguity-is-returned.md) | Provider ambiguity is returned to the caller, never guessed | Providers | Accepted | 2026-08-13 |
| [0005](0005-platform-list-is-not-a-validator.md) | The platform list is a spelling table and a suggestion list, never a validator | Platforms | Accepted | 2026-08-13 |
| [0006](0006-platform-lives-on-the-run.md) | Platform lives on the run, not on the session | Data model | Accepted | 2026-08-13 |
| [0007](0007-no-backlog.md) | The register holds what was played; there is no backlog view | Data model | Accepted | 2026-08-13 |
| [0008](0008-amend-revoke-confirmed-in-conversation.md) | amend and revoke are confirmed in conversation, not by an approval gate | Corrections | Accepted | 2026-08-15 |
| [0009](0009-unrecorded-session-uses-at.md) | A session nobody recorded is filed with --at, read before write | Agent prompt | Accepted | 2026-08-15 |
| [0010](0010-platform-names-are-data.md) | Built-in platform names are data, not interface text | Platforms | Accepted | 2026-08-16 |
| [0011](0011-canonicalize-platforms-on-input-and-read.md) | Platforms are canonicalized on input and on read | Platforms | Accepted | 2026-08-16 |
| [0012](0012-no-edition-stripping-for-providers.md) | Edition suffixes are not stripped when matching against a provider | Resolution | Accepted | 2026-08-16 |
| [0013](0013-sqlite-compared-logically.md) | The committed SQLite cache is compared logically, not byte for byte | Testing | Accepted | 2026-08-16 |
| [0014](0014-platform-hint-never-duplicates-a-game.md) | The platform hint may cost a filter, never a duplicate record | Resolution | Accepted | 2026-08-18 |
| [0015](0015-unknown-config-keys-exit-2.md) | An unknown configuration key is a usage error | Configuration | Accepted | 2026-08-18 |
| [0016](0016-obsidian-assets-are-hardlinks.md) | obsidian/assets is a set of hardlinks, not a symlink | Build and targets | Accepted | 2026-08-19 |
| [0017](0017-agent-leads-with-exit-zero-calls.md) | CLI exit codes stay; the agent leads with calls that exit 0 | Agent prompt | Accepted | 2026-08-19 |
| [0018](0018-telegram-buttons-use-raw-value.md) | Telegram buttons use a raw value, never the callback action | Chat channel | Accepted | 2026-08-19 |
| [0019](0019-agent-gets-words-not-sentences.md) | The agent gets vocabulary from the CLI, never localized sentences | Agent prompt | Accepted | 2026-08-20 |
| [0020](0020-agent-corrects-spelling-never-the-game.md) | The agent corrects how a title is written, never which game is meant | Agent prompt | Accepted | 2026-08-20 |
| [0021](0021-platform-hint-narrows-provider-query.md) | The platform hint narrows the provider query, not the result page | Providers | Accepted | 2026-08-20 |
| [0022](0022-steam-deck-is-pc.md) | Steam Deck is a synonym of PC in the built-in platform table | Platforms | Accepted | 2026-08-20 |
| [0023](0023-late-platform-fill-on-close-only.md) | Only closing a run fills a missing platform; enrich never writes one | Platforms | Accepted | 2026-08-20 |
| [0024](0024-user-covers-are-never-replaced.md) | A user cover is never fetched or replaced by enrichment | Photos and covers | Accepted | 2026-08-20 |
| [0025](0025-no-timezone-detection.md) | The logical day needs no timezone detection and no per-invocation override | Data model | Accepted | 2026-08-20 |
| [0026](0026-photo-kind-drives-cover-and-form.md) | A photo's kind decides the cover offer and the physical-media inference | Photos and covers | Accepted | 2026-08-20 |
| [0027](0027-fixture-webp-never-regenerated.md) | example-vault carries two real WebP assets that are never regenerated | Testing | Accepted | 2026-08-20 |
| [0028](0028-install-is-generated-config.md) | Installation is generated declarative configuration; preferences in chat, secrets never | Container deployment | Proposed | 2026-08-21 |
| [0029](0029-quartz-plans-from-folded-state.md) | The quartz target plans from folded state and never runs Quartz | Site and comments | Accepted | 2026-08-22 |
| [0030](0030-deletion-is-one-manifest-whitelist.md) | Build cleanup stays one manifest whitelist, not a per-target policy | Build and targets | Accepted | 2026-08-22 |
| [0031](0031-wrapper-files-checkin-after-wake.md) | The check-in wrapper files the check-in, after the wake succeeds | Check-ins | Accepted | 2026-08-22 |
| [0032](0032-one-due-row-per-session.md) | due returns at most one row per session, day_cutoff first | Check-ins | Accepted | 2026-08-22 |
| [0033](0033-quiet-hours-evaluated-now.md) | Quiet hours are evaluated against the current time | Check-ins | Accepted | 2026-08-22 |
| [0034](0034-poll-is-a-cron-command.md) | The hourly check-in poll is a cron command, not a heartbeat or an agent turn | Check-ins | Accepted | 2026-08-22 |
| [0035](0035-no-external-services.md) | No external service beyond IGDB is integrated | Providers | Accepted | 2026-08-22 |
| [0036](0036-site-built-off-box-by-default.md) | The site is built off-box by default | Site and comments | Accepted | 2026-08-22 |
| [0037](0037-dev-suffix-while-in-development.md) | A version under development carries a -dev suffix | Versioning and releases | Accepted | 2026-08-22 |
| [0038](0038-target-named-quartz.md) | The site target is named quartz and writes quartz/ | Site and comments | Accepted | 2026-08-23 |
| [0039](0039-wake-is-handed-what-it-cannot-infer.md) | A check-in wake is handed the routing, session and language it cannot infer | Check-ins | Accepted | 2026-08-23 |
| [0040](0040-one-delivery-path-per-wake.md) | One delivery path per wake | Check-ins | Superseded by [0059](0059-checkins-have-no-buttons.md) | 2026-08-23 |
| [0041](0041-wake-is-a-synchronous-agent-run.md) | The wake is a synchronous openclaw agent run, not a second cron job | Check-ins | Accepted | 2026-08-23 |
| [0042](0042-wrapper-stdout-empty-and-source-set.md) | The check-in wrapper prints nothing on stdout and sets GAMEREG_SOURCE itself | Check-ins | Accepted | 2026-08-23 |
| [0043](0043-agent-reads-last-checkin-id.md) | The agent reads last_checkin_id from gamereg open | Check-ins | Accepted | 2026-08-23 |
| [0044](0044-reactions-are-a-second-call.md) | A reaction is a second tool call, mapped in a per-installation workspace file | Chat channel | Accepted | 2026-08-23 |
| [0045](0045-reaction-tokens-never-translated.md) | Reaction tokens are identifiers and are never translated | Agent prompt | Accepted | 2026-08-23 |
| [0046](0046-unbuilt-targets-list.md) | UNBUILT_TARGETS marks a target that is current but not yet built | Build and targets | Accepted | 2026-08-23 |
| [0047](0047-review-reads-no-clock.md) | A year in review reads no clock | Stats and year in review | Accepted | 2026-08-23 |
| [0048](0048-year-hours-are-measured.md) | Hours in a year are measured hours only | Stats and year in review | Accepted | 2026-08-23 |
| [0049](0049-heatmap-is-a-string.md) | The heatmap renderer returns a string and the target decides where it goes | Stats and year in review | Accepted | 2026-08-23 |
| [0050](0050-review-prose-has-no-command.md) | The prose of a year in review has no command | Stats and year in review | Accepted | 2026-08-23 |
| [0051](0051-flavour-is-a-record-of-answers.md) | A rendering flavour is a record of answers, never a name | Site and comments | Accepted | 2026-08-23 |
| [0052](0052-site-wikilinks-name-the-folder.md) | Site wikilinks name their folder; vault wikilinks do not | Site and comments | Accepted | 2026-08-23 |
| [0053](0053-front-page-names.md) | The front page is index.md on the site and Game List.md in the vault | Site and comments | Accepted | 2026-08-23 |
| [0054](0054-vendored-quartz-config.md) | The seeded quartz.config.yaml is Quartz's obsidian template, vendored | Site and comments | Accepted | 2026-08-23 |
| [0055](0055-one-publish-switch-rendered.md) | One images.publish switch, rendered as well as obeyed | Site and comments | Accepted | 2026-08-23 |
| [0056](0056-import-mapping-example-in-the-guide.md) | The example import mapping lives in the guide, not in templates/ | Documentation | Accepted | 2026-08-23 |
| [0057](0057-imported-verdict-is-its-own-event.md) | An imported verdict is filed as its own run.verdict event | Data model | Accepted | 2026-08-23 |
| [0058](0058-astro-gets-a-projection.md) | A future Astro generator is fed a nested projection, never data/export.json | Site and comments | Proposed | 2026-08-23 |
| [0059](0059-checkins-have-no-buttons.md) | Check-ins carry no buttons and have a single sender | Check-ins | Accepted | 2026-08-23 |
| [0060](0060-site-without-client-side-filtering.md) | The site gets the Stats page and reviews, but no client-side filtering | Site and comments | Accepted | 2026-08-26 |
| [0061](0061-site-reuses-the-base-seed.md) | The site reuses the Game Database.base seed unchanged | Site and comments | Accepted | 2026-08-26 |
| [0062](0062-maintenance-is-an-external-script.md) | Vault maintenance is a periodic external script | Container deployment | Accepted | 2026-08-26 |
| [0063](0063-procedure-in-the-always-loaded-card.md) | The common procedure lives in the always-loaded card; rare flows are read on demand | Agent prompt | Accepted | 2026-08-31 |
| [0064](0064-boundaries-by-tools-allow.md) | The agent's boundary is enforced with tools.allow, not prose | Agent prompt | Accepted | 2026-08-31 |
| [0065](0065-status-exposes-correctable-event-ids.md) | open and status expose the event ids a correction needs | Corrections | Accepted | 2026-08-31 |
| [0066](0066-persona-asides-positive-triggers.md) | Persona allowances are stated as positive triggers | Agent prompt | Accepted | 2026-08-31 |
| [0067](0067-every-workspace-slot-is-shipped.md) | Every workspace slot is shipped, so the prompt budget measures the whole prompt | Agent prompt | Superseded by [0106](0106-only-the-injected-set-is-shipped.md) | 2026-08-31 |
| [0068](0068-query-reference-mirrors-the-schema.md) | The query reference mirrors the SQL schema, held to it by a test | Agent prompt | Accepted | 2026-08-31 |
| [0069](0069-prompt-examples-are-whole-calls.md) | Prompt examples are whole tool calls, never payload fragments | Agent prompt | Accepted | 2026-08-31 |
| [0070](0070-prompt-states-rules-not-incidents.md) | Prompt files state rules; incidents are recorded elsewhere | Documentation | Accepted | 2026-08-31 |
| [0071](0071-prompt-cites-no-repository-paths.md) | The deployed prompt cites no repository path | Agent prompt | Accepted | 2026-08-31 |
| [0072](0072-agent-turn-command-budget.md) | An agent turn takes one or two commands | Agent prompt | Accepted | 2026-08-31 |
| [0073](0073-provision-service-registers-checkin.md) | A one-shot provision service registers the check-in job | Container deployment | Accepted | 2026-09-01 |
| [0074](0074-no-required-variables-in-compose.md) | compose.yml uses no required-variable interpolation | Container deployment | Accepted | 2026-09-01 |
| [0075](0075-seeded-vault-is-committed.md) | A freshly seeded vault is committed at creation | Container deployment | Accepted | 2026-09-01 |
| [0076](0076-site-profile-builds-in-the-gamereg-image.md) | The site profile builds Quartz in the gamereg image and watches git HEAD | Site and comments | Accepted | 2026-09-01 |
| [0077](0077-installable-release-is-1-0-0.md) | The installable release ships as 1.0.0, before board games | Versioning and releases | Accepted | 2026-09-01 |
| [0078](0078-one-image-from-npm-pack.md) | One image holds the CLI and the gateway, built from npm pack | Container deployment | Accepted | 2026-09-01 |
| [0079](0079-gateway-local-mode-and-generated-token.md) | The entrypoint sets gateway local mode and generates its access token | Container deployment | Accepted | 2026-09-01 |
| [0080](0080-telegram-pairing-reveals-the-sender-id.md) | Telegram senders learn their numeric id through pairing | Chat channel | Accepted | 2026-09-02 |
| [0081](0081-credentials-in-the-auth-store.md) | Model credentials go into the gateway's auth store; model choice is a separate step | Container deployment | Accepted | 2026-09-02 |
| [0082](0082-health-check-is-a-tcp-connect.md) | The gateway health check is a TCP connect | Container deployment | Accepted | 2026-09-02 |
| [0083](0083-home-is-set-in-the-image.md) | HOME is set in the image | Container deployment | Accepted | 2026-09-02 |
| [0084](0084-nothing-mounted-from-project-dir.md) | Nothing is mounted from the compose project directory | Container deployment | Accepted | 2026-09-02 |
| [0085](0085-profiles-are-independent-and-opt-in.md) | site, comments and tunnel are independent opt-in profiles | Container deployment | Accepted | 2026-09-02 |
| [0086](0086-comments-under-the-site-origin.md) | Comments are served under the site's origin through a subpath proxy | Site and comments | Accepted | 2026-09-02 |
| [0087](0087-seeded-guesses-say-so.md) | A seeded value that nothing can verify says it is a guess | Site and comments | Accepted | 2026-09-03 |
| [0088](0088-phase-numbers-only-in-the-roadmap.md) | Phase numbers appear only in the roadmap and in narrative documents | Documentation | Accepted | 2026-09-04 |
| [0089](0089-public-service-gets-named-variables.md) | The public-facing service receives its environment variables by name | Security | Accepted | 2026-09-04 |
| [0090](0090-query-guard-refuses-reserved-namespaces.md) | The query guard refuses the reserved pragma_ and sqlite_ namespaces | Security | Accepted | 2026-09-04 |
| [0091](0091-release-notes-from-the-changelog.md) | Release pages carry the changelog section; annotated tags carry the narrative | Versioning and releases | Accepted | 2026-09-05 |
| [0092](0092-openclaw-pinned-with-1g-floor.md) | OpenClaw is pinned to 2026.9.4 on Node 24, with a 1g memory floor | Container deployment | Accepted | 2026-09-11 |
| [0093](0093-flow-independent-rules-in-the-card.md) | Rules that apply in every flow live in the always-loaded card | Agent prompt | Accepted | 2026-09-11 |
| [0094](0094-amend-refuses-foreign-keys.md) | amend refuses a patch key the target event does not carry | Corrections | Accepted | 2026-09-13 |
| [0095](0095-workspace-policy-per-file.md) | The container decides each workspace file's policy per file | Container deployment | Accepted | 2026-09-13 |
| [0096](0096-seeded-files-tracked-by-hash.md) | Seeded workspace files are tracked by hash | Container deployment | Accepted | 2026-09-13 |
| [0097](0097-agents-md-is-code.md) | AGENTS.md stays large and code-owned; customization goes in USER.md | Agent prompt | Accepted | 2026-09-13 |
| [0098](0098-dreaming-disabled.md) | memory-core dreaming is disabled | Agent prompt | Accepted | 2026-09-13 |
| [0099](0099-image-tags-edge-and-sha-only.md) | The image is published as :edge and :sha tags only, with no :latest before 1.0.0 | Versioning and releases | Accepted | 2026-09-13 |
| [0100](0100-refused-model-hands-over-to-the-fallback-chain.md) | A model that refuses hands over to the fallback chain instead of being retried | Container deployment | Accepted | 2026-09-16 |
| [0101](0101-attachments-are-resolved-to-their-owner.md) | Attachments reach the derived artifacts resolved to their owner | Build and targets | Accepted | 2026-09-19 |
| [0102](0102-a-break-returns-duration-to-silent.md) | A break returns `duration` to `Silent` | Check-ins | Accepted | 2026-09-20 |
| [0103](0103-quartz-bootstrap-needs-compatible-code-and-theme.md) | Quartz bootstrap needs compatible framework code and a declared theme | Site and comments | Accepted | 2026-09-22 |
| [0104](0104-attach-reports-every-bad-photo.md) | attach ingests every --photo and reports every failure, not just the first | Photos and covers | Accepted | 2026-09-22 |
| [0105](0105-a-photo-is-attached-in-the-turn-it-arrives.md) | A photo is attached in the turn it arrives, and nothing is invented to explain a failure | Agent prompt | Accepted | 2026-09-22 |
| [0106](0106-only-the-injected-set-is-shipped.md) | Only the files OpenClaw injects are shipped as workspace files | Agent prompt | Accepted | 2026-09-23 |

## By area

### Data model

- [0006](0006-platform-lives-on-the-run.md) Platform lives on the run, not on the session
- [0007](0007-no-backlog.md) The register holds what was played; there is no backlog view
- [0025](0025-no-timezone-detection.md) The logical day needs no timezone detection and no per-invocation override
- [0057](0057-imported-verdict-is-its-own-event.md) An imported verdict is filed as its own run.verdict event

### Corrections

- [0008](0008-amend-revoke-confirmed-in-conversation.md) amend and revoke are confirmed in conversation, not by an approval gate
- [0065](0065-status-exposes-correctable-event-ids.md) open and status expose the event ids a correction needs
- [0094](0094-amend-refuses-foreign-keys.md) amend refuses a patch key the target event does not carry

### Resolution

- [0012](0012-no-edition-stripping-for-providers.md) Edition suffixes are not stripped when matching against a provider
- [0014](0014-platform-hint-never-duplicates-a-game.md) The platform hint may cost a filter, never a duplicate record

### Platforms

- [0005](0005-platform-list-is-not-a-validator.md) The platform list is a spelling table and a suggestion list, never a validator
- [0010](0010-platform-names-are-data.md) Built-in platform names are data, not interface text
- [0011](0011-canonicalize-platforms-on-input-and-read.md) Platforms are canonicalized on input and on read
- [0022](0022-steam-deck-is-pc.md) Steam Deck is a synonym of PC in the built-in platform table
- [0023](0023-late-platform-fill-on-close-only.md) Only closing a run fills a missing platform; enrich never writes one

### Providers

- [0004](0004-provider-ambiguity-is-returned.md) Provider ambiguity is returned to the caller, never guessed
- [0021](0021-platform-hint-narrows-provider-query.md) The platform hint narrows the provider query, not the result page
- [0035](0035-no-external-services.md) No external service beyond IGDB is integrated

### Photos and covers

- [0024](0024-user-covers-are-never-replaced.md) A user cover is never fetched or replaced by enrichment
- [0026](0026-photo-kind-drives-cover-and-form.md) A photo's kind decides the cover offer and the physical-media inference
- [0104](0104-attach-reports-every-bad-photo.md) attach ingests every --photo and reports every failure, not just the first

### Configuration

- [0015](0015-unknown-config-keys-exit-2.md) An unknown configuration key is a usage error

### Build and targets

- [0001](0001-run-notes-written-whole.md) Run notes are written whole; game notes are spliced
- [0003](0003-bases-not-dataview.md) Obsidian Bases are supported; Dataview is not
- [0016](0016-obsidian-assets-are-hardlinks.md) obsidian/assets is a set of hardlinks, not a symlink
- [0030](0030-deletion-is-one-manifest-whitelist.md) Build cleanup stays one manifest whitelist, not a per-target policy
- [0046](0046-unbuilt-targets-list.md) UNBUILT_TARGETS marks a target that is current but not yet built
- [0101](0101-attachments-are-resolved-to-their-owner.md) Attachments reach the derived artifacts resolved to their owner

### Site and comments

- [0029](0029-quartz-plans-from-folded-state.md) The quartz target plans from folded state and never runs Quartz
- [0036](0036-site-built-off-box-by-default.md) The site is built off-box by default
- [0038](0038-target-named-quartz.md) The site target is named quartz and writes quartz/
- [0051](0051-flavour-is-a-record-of-answers.md) A rendering flavour is a record of answers, never a name
- [0052](0052-site-wikilinks-name-the-folder.md) Site wikilinks name their folder; vault wikilinks do not
- [0053](0053-front-page-names.md) The front page is index.md on the site and Game List.md in the vault
- [0054](0054-vendored-quartz-config.md) The seeded quartz.config.yaml is Quartz's obsidian template, vendored
- [0103](0103-quartz-bootstrap-needs-compatible-code-and-theme.md) Quartz bootstrap needs compatible framework code and a declared theme
- [0055](0055-one-publish-switch-rendered.md) One images.publish switch, rendered as well as obeyed
- [0058](0058-astro-gets-a-projection.md) A future Astro generator is fed a nested projection, never data/export.json *(Proposed)*
- [0060](0060-site-without-client-side-filtering.md) The site gets the Stats page and reviews, but no client-side filtering
- [0061](0061-site-reuses-the-base-seed.md) The site reuses the Game Database.base seed unchanged
- [0076](0076-site-profile-builds-in-the-gamereg-image.md) The site profile builds Quartz in the gamereg image and watches git HEAD
- [0086](0086-comments-under-the-site-origin.md) Comments are served under the site's origin through a subpath proxy
- [0087](0087-seeded-guesses-say-so.md) A seeded value that nothing can verify says it is a guess

### Stats and year in review

- [0047](0047-review-reads-no-clock.md) A year in review reads no clock
- [0048](0048-year-hours-are-measured.md) Hours in a year are measured hours only
- [0049](0049-heatmap-is-a-string.md) The heatmap renderer returns a string and the target decides where it goes
- [0050](0050-review-prose-has-no-command.md) The prose of a year in review has no command

### Check-ins

- [0002](0002-chase-has-its-own-slot.md) The morning chase has its own delivery slot, separate from day_cutoff
- [0031](0031-wrapper-files-checkin-after-wake.md) The check-in wrapper files the check-in, after the wake succeeds
- [0032](0032-one-due-row-per-session.md) due returns at most one row per session, day_cutoff first
- [0033](0033-quiet-hours-evaluated-now.md) Quiet hours are evaluated against the current time
- [0034](0034-poll-is-a-cron-command.md) The hourly check-in poll is a cron command, not a heartbeat or an agent turn
- [0039](0039-wake-is-handed-what-it-cannot-infer.md) A check-in wake is handed the routing, session and language it cannot infer
- [0040](0040-one-delivery-path-per-wake.md) One delivery path per wake *(Superseded)*
- [0041](0041-wake-is-a-synchronous-agent-run.md) The wake is a synchronous openclaw agent run, not a second cron job
- [0042](0042-wrapper-stdout-empty-and-source-set.md) The check-in wrapper prints nothing on stdout and sets GAMEREG_SOURCE itself
- [0043](0043-agent-reads-last-checkin-id.md) The agent reads last_checkin_id from gamereg open
- [0059](0059-checkins-have-no-buttons.md) Check-ins carry no buttons and have a single sender
- [0102](0102-a-break-returns-duration-to-silent.md) A break returns `duration` to `Silent`

### Agent prompt

- [0009](0009-unrecorded-session-uses-at.md) A session nobody recorded is filed with --at, read before write
- [0017](0017-agent-leads-with-exit-zero-calls.md) CLI exit codes stay; the agent leads with calls that exit 0
- [0019](0019-agent-gets-words-not-sentences.md) The agent gets vocabulary from the CLI, never localized sentences
- [0020](0020-agent-corrects-spelling-never-the-game.md) The agent corrects how a title is written, never which game is meant
- [0045](0045-reaction-tokens-never-translated.md) Reaction tokens are identifiers and are never translated
- [0063](0063-procedure-in-the-always-loaded-card.md) The common procedure lives in the always-loaded card; rare flows are read on demand
- [0064](0064-boundaries-by-tools-allow.md) The agent's boundary is enforced with tools.allow, not prose
- [0066](0066-persona-asides-positive-triggers.md) Persona allowances are stated as positive triggers
- [0067](0067-every-workspace-slot-is-shipped.md) Every workspace slot is shipped, so the prompt budget measures the whole prompt *(Superseded)*
- [0068](0068-query-reference-mirrors-the-schema.md) The query reference mirrors the SQL schema, held to it by a test
- [0069](0069-prompt-examples-are-whole-calls.md) Prompt examples are whole tool calls, never payload fragments
- [0071](0071-prompt-cites-no-repository-paths.md) The deployed prompt cites no repository path
- [0072](0072-agent-turn-command-budget.md) An agent turn takes one or two commands
- [0093](0093-flow-independent-rules-in-the-card.md) Rules that apply in every flow live in the always-loaded card
- [0097](0097-agents-md-is-code.md) AGENTS.md stays large and code-owned; customization goes in USER.md
- [0098](0098-dreaming-disabled.md) memory-core dreaming is disabled
- [0105](0105-a-photo-is-attached-in-the-turn-it-arrives.md) A photo is attached in the turn it arrives, and nothing is invented to explain a failure
- [0106](0106-only-the-injected-set-is-shipped.md) Only the files OpenClaw injects are shipped as workspace files

### Chat channel

- [0018](0018-telegram-buttons-use-raw-value.md) Telegram buttons use a raw value, never the callback action
- [0044](0044-reactions-are-a-second-call.md) A reaction is a second tool call, mapped in a per-installation workspace file
- [0080](0080-telegram-pairing-reveals-the-sender-id.md) Telegram senders learn their numeric id through pairing

### Container deployment

- [0028](0028-install-is-generated-config.md) Installation is generated declarative configuration; preferences in chat, secrets never *(Proposed)*
- [0062](0062-maintenance-is-an-external-script.md) Vault maintenance is a periodic external script
- [0073](0073-provision-service-registers-checkin.md) A one-shot provision service registers the check-in job
- [0074](0074-no-required-variables-in-compose.md) compose.yml uses no required-variable interpolation
- [0075](0075-seeded-vault-is-committed.md) A freshly seeded vault is committed at creation
- [0078](0078-one-image-from-npm-pack.md) One image holds the CLI and the gateway, built from npm pack
- [0079](0079-gateway-local-mode-and-generated-token.md) The entrypoint sets gateway local mode and generates its access token
- [0081](0081-credentials-in-the-auth-store.md) Model credentials go into the gateway's auth store; model choice is a separate step
- [0082](0082-health-check-is-a-tcp-connect.md) The gateway health check is a TCP connect
- [0083](0083-home-is-set-in-the-image.md) HOME is set in the image
- [0084](0084-nothing-mounted-from-project-dir.md) Nothing is mounted from the compose project directory
- [0085](0085-profiles-are-independent-and-opt-in.md) site, comments and tunnel are independent opt-in profiles
- [0092](0092-openclaw-pinned-with-1g-floor.md) OpenClaw is pinned to 2026.9.4 on Node 24, with a 1g memory floor
- [0095](0095-workspace-policy-per-file.md) The container decides each workspace file's policy per file
- [0096](0096-seeded-files-tracked-by-hash.md) Seeded workspace files are tracked by hash
- [0100](0100-refused-model-hands-over-to-the-fallback-chain.md) A model that refuses hands over to the fallback chain instead of being retried

### Security

- [0089](0089-public-service-gets-named-variables.md) The public-facing service receives its environment variables by name
- [0090](0090-query-guard-refuses-reserved-namespaces.md) The query guard refuses the reserved pragma_ and sqlite_ namespaces

### Versioning and releases

- [0037](0037-dev-suffix-while-in-development.md) A version under development carries a -dev suffix
- [0077](0077-installable-release-is-1-0-0.md) The installable release ships as 1.0.0, before board games
- [0091](0091-release-notes-from-the-changelog.md) Release pages carry the changelog section; annotated tags carry the narrative
- [0099](0099-image-tags-edge-and-sha-only.md) The image is published as :edge and :sha tags only, with no :latest before 1.0.0

### Testing

- [0013](0013-sqlite-compared-logically.md) The committed SQLite cache is compared logically, not byte for byte
- [0027](0027-fixture-webp-never-regenerated.md) example-vault carries two real WebP assets that are never regenerated

### Documentation

- [0056](0056-import-mapping-example-in-the-guide.md) The example import mapping lives in the guide, not in templates/
- [0070](0070-prompt-states-rules-not-incidents.md) Prompt files state rules; incidents are recorded elsewhere
- [0088](0088-phase-numbers-only-in-the-roadmap.md) Phase numbers appear only in the roadmap and in narrative documents
