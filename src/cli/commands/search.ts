/**
 * `gamereg search <term>` — look something up without recording anything.
 *
 * Returns candidates in the same shape as exit code 3, from the same ranking
 * code. Local match first (steps 1–5); an empty local result falls through to
 * provider search (step 6, docs/spec/03-resolution.md) unless `--local-only`
 * was passed. `search` never writes, so it is the one place besides `enrich`
 * allowed to reach the network — a write command's resolution never does
 * (00-architecture.md invariant 5).
 *
 * A provider that is merely unconfigured degrades to "no provider results",
 * silently: most vaults never set up credentials, and search must keep
 * working locally regardless.
 */
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { createIgdbProvider } from '../../providers/igdb.ts'
import type { Provider } from '../../providers/provider.ts'
import { createRawgProvider } from '../../providers/rawg.ts'
import { platformTable, samePlatform, type PlatformTable } from '../../core/platforms.ts'
import { candidateFromProvider, candidateOf, search, CANDIDATE_LIMIT, type Candidate } from '../../resolve/resolve.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { load } from '../workspace.ts'

type Options = { platform?: string; localOnly?: boolean }

function providers(root: string): Provider[] {
  return [createIgdbProvider(root), createRawgProvider(root)]
}

/**
 * Highest first, by how many of a candidate's platforms this vault owns
 * (`config.platforms`) — a preference, never a filter: nothing is dropped,
 * only reordered, the same way `platformGroups()` already prefers owned
 * platforms when offering a closing prompt (02-cli.md, *What gets offered*).
 * A vault with nothing configured yet (`table.configured` empty) scores
 * everything zero and the provider's own relevance order survives untouched
 * — `Array.prototype.sort` is stable, so ties never reshuffle.
 */
export function rankByOwnership(candidates: readonly Candidate[], table: PlatformTable): Candidate[] {
  if (table.configured.length === 0) return [...candidates]
  const score = (candidate: Candidate): number =>
    candidate.platforms.filter((name) => table.configured.some((owned) => samePlatform(name, owned, table))).length
  return [...candidates].sort((left, right) => score(right) - score(left))
}

/**
 * Canonicalized on both sides, same as the local path (`matchesPlatform`,
 * resolve.ts) — a raw string match would miss "PSX" against a provider that
 * spells it "PlayStation", the exact case the built-in table's synonyms
 * exist to cover.
 */
export function matchesPlatformHint(
  candidate: { platforms: readonly string[] },
  platform: string | undefined,
  table: PlatformTable,
): boolean {
  if (platform === undefined || platform === '') return true
  return candidate.platforms.some((name) => samePlatform(name, platform, table))
}

/** Tries each provider in order; the first to return anything wins. Unconfigured providers are skipped, not fatal. */
async function providerCandidates(
  root: string,
  term: string,
  platform: string | undefined,
  table: PlatformTable,
): Promise<Candidate[]> {
  for (const provider of providers(root)) {
    let results
    try {
      results = await provider.search(term)
    } catch (error) {
      if (error instanceof GameregError && error.code === 6) continue
      throw error
    }
    const filtered = results.filter((candidate) => matchesPlatformHint(candidate, platform, table))
    if (filtered.length > 0) {
      const shaped = filtered.map((candidate) => candidateFromProvider(provider.name, candidate))
      return rankByOwnership(shaped, table)
    }
  }
  return []
}

export function registerSearch(registrar: Registrar): void {
  registrar
    .command('search', 'help.search')
    .argument('<term>', registrar.t('help.arg.term'))
    .option('--platform <name>', registrar.t('help.opt.platform'))
    .option('--local-only', registrar.t('help.opt.local_only'))
    .action(async (term: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)
      const table = platformTable(cli.vault.config.platforms)

      const found = search(workspace.state, term, options.platform, table)
      let candidates: Candidate[] = found.slice(0, CANDIDATE_LIMIT).map(candidateOf)
      let truncated = found.length > CANDIDATE_LIMIT

      if (candidates.length === 0 && options.localOnly !== true) {
        const fromProviders = await providerCandidates(cli.vault.root, term, options.platform, table)
        candidates = fromProviders.slice(0, CANDIDATE_LIMIT)
        truncated = fromProviders.length > CANDIDATE_LIMIT
      }

      const prose =
        candidates.length === 0
          ? [cli.t('prose.search.none', { query: term })]
          : [
              cli.t('prose.search.header', { count: candidates.length, query: term }),
              ...candidates.map((candidate) =>
                candidate.source === 'local'
                  ? cli.t('prompt.candidate_local', {
                      title: candidate.title,
                      year: candidate.year === null ? '' : ` (${candidate.year})`,
                      status: cli.label('status', candidate.status ?? 'unplayed'),
                    })
                  : cli.t('prompt.candidate_new', {
                      title: candidate.title,
                      year: candidate.year === null ? '' : ` (${candidate.year})`,
                      platforms: candidate.platforms.length === 0 ? '' : ` [${candidate.platforms.join(', ')}]`,
                    }),
              ),
            ]

      emit(cli, {
        action: 'search',
        result: {
          query: term,
          candidates,
          ...(truncated ? { truncated: true } : {}),
        },
        events: [],
        prose,
      })
    })
}
