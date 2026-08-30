/**
 * `gamereg enrich [<query>] [--provider igdb] [--match <ref>] [--all] [--missing] [--covers]`
 * — the network step, isolated (docs/spec/02-cli.md).
 *
 * The only command that reaches the network (00-architecture.md invariant 5).
 * A provider failure never blocks recording: whatever succeeded is still
 * committed to the log, and only the exit code (6) and the JSON envelope say
 * something did not — the same shape `build` uses for a failed target.
 *
 * Ambiguity (more than one plausible provider record) is a return value, not
 * a silent skip — same contract as every other resolution in this CLI
 * (03-resolution.md): a human at a terminal gets a menu, a script or agent
 * gets exit 3 and `candidates[]`, and re-invokes with `--match <ref>`.
 * `--all` never asks — an ambiguous match during a bulk/cron run is left as
 * unresolved as no match at all.
 */
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import type { GameState } from '../../core/fold.ts'
import {
  canonicalPlatform,
  platformTable,
  samePlatform,
  type PlatformTable,
} from '../../core/platforms.ts'
import { ingestUrl } from '../../images/ingest.ts'
import type { Provider, ProviderCandidate, ProviderDetail } from '../../providers/provider.ts'
import { createProvider, isKnownProvider, KNOWN_PROVIDERS, providerChain, unknownProvider } from '../../providers/registry.ts'
import { normalize } from '../../resolve/normalize.ts'
import { candidateFromProvider, CANDIDATE_LIMIT, parseReference } from '../../resolve/resolve.ts'
import type { Cli } from '../context.ts'
import { createContext } from '../context.ts'
import { emit, emitFailure } from '../output.ts'
import { choose } from '../prompt.ts'
import type { Registrar } from '../register.ts'
import { ambiguousError, commit, load, resolveGame, stage, type Workspace } from '../workspace.ts'

type Options = {
  id?: string
  provider?: string
  match?: string
  all?: boolean
  missing?: boolean
  covers?: boolean
}

export type FindResult =
  | { kind: 'match'; detail: ProviderDetail }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: ProviderCandidate[] }

/**
 * Synonyms first — a run recorded as `SNES` has to match a catalog that calls
 * it "Super Nintendo Entertainment System", and no amount of substring
 * matching gets there. Then the substring rule, which is what makes a vaguely
 * recorded "Atari" match "Atari 2600" in either direction.
 */
function platformMatches(a: string, b: string, table: PlatformTable): boolean {
  if (samePlatform(a, b, table)) return true
  const x = normalize(canonicalPlatform(a, table) ?? a)
  const y = normalize(canonicalPlatform(b, table) ?? b)
  return x === y || x.includes(y) || y.includes(x)
}

/** What the user actually typed on `start`/`past` — never `game.platforms`, which a prior enrich may have overwritten. */
function knownPlatforms(game: GameState): string[] {
  const values = game.runs.map((run) => run.platform).filter((platform): platform is string => platform !== null)
  return [...new Set(values)]
}

/**
 * The same auto-resolution threshold as local resolution (03-resolution.md):
 * exactly one result, and its normalized title matches exactly. Anything
 * short of that is either nothing, or genuine ambiguity — never a guess.
 *
 * Edition-suffix stripping is off here (`{ editions: false }`), unlike local
 * resolution: a catalog frequently lists "Deluxe Edition" as its own entry
 * with its own id — stripping the suffix would collapse it with the base
 * game and turn one confident match into an ambiguous pair.
 *
 * When title matching alone leaves more than one candidate, the platform(s)
 * already recorded on this game's runs narrow it further — and may resolve
 * it outright, unlike 03-resolution.md's "the platform hint filters, it
 * does not resolve" rule for *local* resolution. That rule protects against
 * picking the wrong game; this is a different, narrower question — the
 * game is already known, the ambiguity is only which catalog SKU
 * represents it, and a platform the user already told the tool about is
 * strong evidence for that. Reads `game.runs[].platform` (what the user
 * actually typed), never `game.platforms` (which a prior enrich may have
 * already overwritten with a different provider's data).
 *
 * `searchTerm` is deliberately a separate argument from `game.title`, not
 * derived from it in here. The caller resolves which local game this is
 * (offline, normalized, steps 1-5 of 03-resolution.md) independently of
 * what string then goes to the provider: a literal `<query>` on the CLI
 * (e.g. a retyped "Pac-Man" against a game stored as "Pacman") is sent
 * verbatim, because the provider's own relevance search is not the same
 * matching gamereg's normalizer does locally — a string that resolves the
 * local game fine can still search the catalog poorly. Only when no
 * `<query>` was given (the `--all`/cron path) does the caller fall back to
 * `game.title`. See 02-cli.md's `enrich` section.
 */
export async function findDetail(
  provider: Provider,
  game: GameState,
  searchTerm: string,
  /** This vault's platform spellings; the built-in table alone when omitted. */
  platforms: PlatformTable = platformTable(),
): Promise<FindResult> {
  const known = game.providers[provider.name]
  if (known !== undefined) {
    const detail = await provider.fetch(String(known))
    return detail === null ? { kind: 'none' } : { kind: 'match', detail }
  }

  // findExact, not search: a relevance-ranked search can bury an old,
  // low-engagement release arbitrarily deep and never surface it at any
  // reasonable page size (confirmed live with IGDB's 1982 Atari 2600
  // "Pac-Man" — see provider.ts's file comment). findExact is complete.
  const needle = normalize(searchTerm, { editions: false })
  const candidates = await provider.findExact(searchTerm)
  const matches = candidates.filter((candidate) => normalize(candidate.title, { editions: false }) === needle)
  if (matches.length === 0) return { kind: 'none' }

  if (matches.length > 1) {
    const recorded = knownPlatforms(game)
    if (recorded.length > 0) {
      const narrowed = matches.filter((candidate) =>
        candidate.platforms.some((p) => recorded.some((value) => platformMatches(p, value, platforms))),
      )
      if (narrowed.length === 1) {
        const detail = await provider.fetch(narrowed[0]!.id)
        return detail === null ? { kind: 'none' } : { kind: 'match', detail }
      }
      if (narrowed.length > 1) {
        // Still ambiguous, but nothing is hidden: platform-matching
        // candidates come first, the rest follow in their original order.
        const narrowedIds = new Set(narrowed.map((candidate) => candidate.id))
        const rest = matches.filter((candidate) => !narrowedIds.has(candidate.id))
        return { kind: 'ambiguous', candidates: [...narrowed, ...rest] }
      }
      // narrowed.length === 0: none of the candidates match the known
      // platform — fall through to the full, unfiltered set. The provider
      // may simply not carry that particular release.
    }
    return { kind: 'ambiguous', candidates: matches }
  }

  const detail = await provider.fetch(matches[0]!.id)
  return detail === null ? { kind: 'none' } : { kind: 'match', detail }
}

export type EnrichOutcome =
  | { kind: 'enriched'; provider: string }
  | { kind: 'skipped' }
  | { kind: 'failed'; message: string }
  | { kind: 'ambiguous'; provider: string; candidates: ProviderCandidate[] }

/**
 * `--covers` downloads the provider's cover art through the same pipeline as
 * `--photo` (docs/spec/06-roadmap.md, phase 1) — not just the URL. A user
 * cover is never spent a network call on, since it would be discarded by the
 * fold regardless (01-model.md "Cover precedence"). A failed download falls
 * back to the bare URL, same as before this existed: `ingestUrl` never
 * throws, so a provider serving a broken image never blocks the metadata
 * from committing.
 */
async function coverField(
  cli: Cli,
  game: GameState,
  detail: ProviderDetail,
  covers: boolean,
  fetchImpl: typeof fetch,
): Promise<{ url: string; sha256?: string } | null> {
  if (!covers || detail.cover_url === null || game.cover?.source === 'user') return null
  const ingested = await ingestUrl(cli.vault, detail.cover_url, undefined, fetchImpl)
  return ingested === null ? { url: detail.cover_url } : { url: detail.cover_url, sha256: ingested.sha256 }
}

/**
 * Stages the `game.enrich` event. Shared by a clean match, an
 * interactively-picked candidate, and `--match`. `fetchImpl` is injected the
 * same way `providers/igdb.ts` does it, threaded down to the cover download,
 * so tests mock at this boundary and never open a socket.
 */
export async function applyDetail(
  cli: Cli,
  workspace: Workspace,
  game: GameState,
  provider: string,
  detail: ProviderDetail,
  covers: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<{ kind: 'enriched'; provider: string }> {
  const cover = await coverField(cli, game, detail, covers, fetchImpl)
  stage(cli, workspace, 'game.enrich', {
    game_id: game.game_id,
    provider,
    fields: { ...detail.fields, id: detail.id },
    ...(cover === null ? {} : { cover }),
  })
  return { kind: 'enriched', provider }
}

/** Shapes an ambiguous provider outcome into the same exit-3 envelope every other resolution ambiguity uses. */
export function ambiguousOutcomeError(
  game: GameState,
  provider: string,
  candidates: readonly ProviderCandidate[],
): GameregError {
  const shaped = candidates.slice(0, CANDIDATE_LIMIT).map((candidate) => candidateFromProvider(provider, candidate))
  return ambiguousError(game.title, shaped, candidates.length > CANDIDATE_LIMIT)
}

export async function enrichGame(
  cli: Cli,
  workspace: Workspace,
  game: GameState,
  providers: readonly Provider[],
  covers: boolean,
  bulk: boolean,
  searchTerm: string = game.title,
  fetchImpl: typeof fetch = fetch,
): Promise<EnrichOutcome> {
  // Whether at least one provider actually answered — reachable, credentials
  // present — regardless of whether it found a match. A provider that is
  // merely unconfigured (the common case: most vaults set up only one) must
  // never turn "the working provider found nothing" into a reported failure.
  let attempted = false
  const failures: string[] = []
  let firstAmbiguous: { provider: string; candidates: ProviderCandidate[] } | null = null

  for (const provider of providers) {
    let result: FindResult
    try {
      result = await findDetail(provider, game, searchTerm, platformTable(cli.vault.config.platforms))
      attempted = true
    } catch (error) {
      if (error instanceof GameregError && error.code === 6) {
        failures.push(cli.t(error.key, error.params))
        continue
      }
      throw error
    }

    if (result.kind === 'none') continue
    if (result.kind === 'ambiguous') {
      // Keep trying the rest of the chain — a later provider may still give
      // a clean unique match. Remember only the first ambiguous set, so the
      // eventual answer (if the chain never resolves) is deterministic: the
      // configured provider order.
      firstAmbiguous ??= { provider: provider.name, candidates: result.candidates }
      continue
    }

    return applyDetail(cli, workspace, game, provider.name, result.detail, covers, fetchImpl)
  }

  // `--all` never asks: an ambiguous bulk match is left unresolved, same as
  // no match at all — safe to run unattended.
  if (firstAmbiguous !== null && !bulk) {
    return { kind: 'ambiguous', provider: firstAmbiguous.provider, candidates: firstAmbiguous.candidates }
  }

  if (attempted || failures.length === 0) return { kind: 'skipped' }
  return { kind: 'failed', message: failures.join('; ') }
}

export function registerEnrich(registrar: Registrar): void {
  registrar
    .command('enrich', 'help.enrich')
    .argument('[query]', registrar.t('help.arg.query'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .option('--provider <name>', registrar.t('help.opt.provider'))
    .option('--match <ref>', registrar.t('help.opt.match'))
    .option('--all', registrar.t('help.opt.all_games'))
    .option('--missing', registrar.t('help.opt.missing'))
    .option('--covers', registrar.t('help.opt.covers'))
    .action(async (query: string | undefined, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      if (options.provider !== undefined && !isKnownProvider(options.provider)) {
        throw unknownProvider(options.provider)
      }

      if (options.match !== undefined && options.all === true) {
        throw new GameregError('usage', 'error.match_with_all')
      }

      // `--missing` is a bulk selector, same family as `--all`: mutually
      // exclusive with the other ways of naming a target, since it names its
      // targets itself.
      if (options.missing === true && options.all === true) {
        throw new GameregError('usage', 'error.missing_with_all')
      }
      if (options.missing === true && options.match !== undefined) {
        throw new GameregError('usage', 'error.missing_with_match')
      }
      if (options.missing === true && query !== undefined) {
        throw new GameregError('usage', 'error.missing_with_query')
      }

      // `--match` is trusted, never searched: the caller already resolved
      // which catalog record is correct (a human picked it from a menu, or
      // an agent re-invoked with a ref from an earlier candidates[] list).
      let forcedDetail: { provider: string; detail: ProviderDetail } | null = null
      if (options.match !== undefined) {
        const reference = parseReference(options.match)
        if (reference === null || reference.kind !== 'provider') {
          throw new GameregError('usage', 'error.bad_match_ref', { value: options.match })
        }
        if (!isKnownProvider(reference.provider)) throw unknownProvider(reference.provider)
        const provider = createProvider(reference.provider, cli.vault.root)
        const detail = await provider.fetch(reference.id)
        if (detail === null) throw new GameregError('not_found', 'error.unknown_id', { ref: options.match })
        forcedDetail = { provider: reference.provider, detail }
      }

      // "Missing" means never actually enriched for this provider — not
      // merely "no provider id on record". `start --id <provider ref>` with
      // no local match creates a game carrying a bare reference (so a later
      // enrich has something to fetch by id), with no metadata fetched at
      // create time (invariant 5); that stub must still count as missing.
      // `enrichedProviders` (core/fold.ts) is set only when a real
      // `game.enrich` event has landed, which is what distinguishes the two.
      const missingProviderName = options.provider ?? KNOWN_PROVIDERS[0]
      const bulk = options.all === true || options.missing === true
      const covers = options.covers === true

      const targets: GameState[] =
        options.all === true
          ? [...workspace.state.games]
          : options.missing === true
            ? workspace.state.games.filter((game) => {
                if (!game.enrichedProviders.includes(missingProviderName)) return true
                // Already enriched: `--covers` also backfills art for a game
                // that has metadata but no cover on record (fetched before
                // `--covers` existed, or never given it).
                return covers && game.cover === null
              })
            : [await resolveGame(cli, workspace, query ?? null, { id: options.id, allowCreate: false })]

      const providers = providerChain(cli.vault.root, options.provider)

      const enriched: { game_id: string; title: string; provider: string }[] = []
      const skipped: { game_id: string; title: string }[] = []
      const failed: { game_id: string; title: string; message: string }[] = []

      for (const game of targets) {
        if (forcedDetail !== null) {
          const applied = await applyDetail(cli, workspace, game, forcedDetail.provider, forcedDetail.detail, covers)
          enriched.push({ game_id: game.game_id, title: game.title, provider: applied.provider })
          continue
        }

        // The literal `<query>` string, not the resolved game's stored title,
        // is what gets sent to the provider search — see findDetail's doc
        // comment. `--all`/`--missing` target every matching game at once, so
        // there is no single game a typed `<query>` could mean here; both
        // always search with each game's currently stored title, unchanged.
        const searchTerm = bulk ? game.title : (query ?? game.title)
        const outcome = await enrichGame(cli, workspace, game, providers, covers, bulk, searchTerm)

        if (outcome.kind === 'ambiguous') {
          if (!cli.interactive) throw ambiguousOutcomeError(game, outcome.provider, outcome.candidates)

          const candidates = outcome.candidates
            .slice(0, CANDIDATE_LIMIT)
            .map((candidate) => candidateFromProvider(outcome.provider, candidate))
          const choice = await choose(cli, game.title, candidates, false)
          if (choice.kind !== 'candidate') throw new GameregError('usage', 'prompt.cancelled')

          const chosenRef = parseReference(choice.ref)
          if (chosenRef === null || chosenRef.kind !== 'provider') {
            throw new GameregError('error', 'error.unexpected', { message: choice.ref })
          }
          const chosenProvider = providers.find((candidate) => candidate.name === chosenRef.provider)
          if (chosenProvider === undefined) {
            throw new GameregError('error', 'error.unexpected', { message: chosenRef.provider })
          }
          const detail = await chosenProvider.fetch(chosenRef.id)
          if (detail === null) throw new GameregError('not_found', 'error.unknown_id', { ref: choice.ref })

          const applied = await applyDetail(cli, workspace, game, chosenProvider.name, detail, covers)
          enriched.push({ game_id: game.game_id, title: game.title, provider: applied.provider })
          continue
        }

        if (outcome.kind === 'enriched') {
          enriched.push({ game_id: game.game_id, title: game.title, provider: outcome.provider })
        } else if (outcome.kind === 'skipped') {
          skipped.push({ game_id: game.game_id, title: game.title })
        } else {
          failed.push({ game_id: game.game_id, title: game.title, message: outcome.message })
        }
      }

      // Whatever succeeded is committed even when something else failed —
      // the same principle build.ts uses for a failed target.
      const events = commit(cli, workspace)
      const payload = { enriched, skipped, failed }

      if (failed.length > 0) {
        process.exitCode = emitFailure(
          cli,
          new GameregError(
            'provider_unavailable',
            'prose.enrich.failed_count',
            { count: failed.length },
            { details: { error: 'provider_unavailable', result: payload } },
          ),
        )
        if (!cli.json && !cli.quiet) {
          for (const entry of failed) process.stderr.write(`${cli.t('prose.enrich.failed', entry)}\n`)
        }
        return
      }

      const prose = [
        ...enriched.map((entry) => cli.t('prose.enrich.done', entry)),
        ...(skipped.length > 0 ? [cli.t('prose.enrich.skipped', { count: skipped.length })] : []),
      ]

      emit(cli, {
        action: 'game.enrich',
        result: payload,
        events,
        prose: prose.length > 0 ? prose : [cli.t('prose.enrich.none')],
      })
    })
}
