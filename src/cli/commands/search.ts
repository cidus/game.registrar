/**
 * `gamereg search <term>` — look something up without recording anything.
 *
 * Returns candidates in the same shape as exit code 3, from the same ranking
 * code. Phase 0 is local-only, so `--local-only` is accepted and redundant.
 */
import type { Command } from 'commander'

import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { candidateOf, search, CANDIDATE_LIMIT } from '../../resolve/resolve.ts'
import { load } from '../workspace.ts'

type Options = { platform?: string; localOnly?: boolean }

export function registerSearch(registrar: Registrar): void {
  registrar
    .command('search', 'help.search')
    .argument('<term>', registrar.t('help.arg.term'))
    .option('--platform <name>', registrar.t('help.opt.platform'))
    .option('--local-only', registrar.t('help.opt.local_only'))
    .action(async (term: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const found = search(workspace.state, term, options.platform)
      const candidates = found.slice(0, CANDIDATE_LIMIT).map(candidateOf)

      const prose =
        candidates.length === 0
          ? [cli.t('prose.search.none', { query: term })]
          : [
              cli.t('prose.search.header', { count: candidates.length, query: term }),
              ...candidates.map((candidate) =>
                cli.t('prompt.candidate_local', {
                  title: candidate.title,
                  year: candidate.year === null ? '' : ` (${candidate.year})`,
                  status: cli.label('status', candidate.status ?? 'unplayed'),
                }),
              ),
            ]

      emit(cli, {
        action: 'search',
        result: {
          query: term,
          candidates,
          ...(found.length > CANDIDATE_LIMIT ? { truncated: true } : {}),
        },
        events: [],
        prose,
      })
    })
}
