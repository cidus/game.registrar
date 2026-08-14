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
import { normalize } from '../../resolve/normalize.ts'
import { platformTable } from '../../core/platforms.ts'
import { candidateFromProvider, candidateOf, search, CANDIDATE_LIMIT, type Candidate } from '../../resolve/resolve.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { load } from '../workspace.ts'

type Options = { platform?: string; localOnly?: boolean }

function providers(root: string): Provider[] {
  return [createIgdbProvider(root), createRawgProvider(root)]
}

/** Tries each provider in order; the first to return anything wins. Unconfigured providers are skipped, not fatal. */
async function providerCandidates(root: string, term: string, platform: string | undefined): Promise<Candidate[]> {
  for (const provider of providers(root)) {
    let results
    try {
      results = await provider.search(term)
    } catch (error) {
      if (error instanceof GameregError && error.code === 6) continue
      throw error
    }
    const filtered =
      platform === undefined || platform === ''
        ? results
        : results.filter((candidate) => candidate.platforms.some((name) => normalize(name) === normalize(platform)))
    if (filtered.length > 0) return filtered.map((candidate) => candidateFromProvider(provider.name, candidate))
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

      const found = search(
        workspace.state,
        term,
        options.platform,
        platformTable(cli.vault.config.platforms),
      )
      let candidates: Candidate[] = found.slice(0, CANDIDATE_LIMIT).map(candidateOf)
      let truncated = found.length > CANDIDATE_LIMIT

      if (candidates.length === 0 && options.localOnly !== true) {
        const fromProviders = await providerCandidates(cli.vault.root, term, options.platform)
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
