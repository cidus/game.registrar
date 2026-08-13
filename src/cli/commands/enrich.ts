/**
 * `gamereg enrich [<query>] [--provider igdb] [--all] [--covers]` — the
 * network step, isolated (docs/spec/02-cli.md).
 *
 * The only command that reaches the network (00-architecture.md invariant 5).
 * A provider failure never blocks recording: whatever succeeded is still
 * committed to the log, and only the exit code (6) and the JSON envelope say
 * something did not — the same shape `build` uses for a failed target.
 */
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import type { GameState } from '../../core/fold.ts'
import { createIgdbProvider } from '../../providers/igdb.ts'
import type { Provider, ProviderDetail } from '../../providers/provider.ts'
import { createRawgProvider } from '../../providers/rawg.ts'
import { normalize } from '../../resolve/normalize.ts'
import type { Cli } from '../context.ts'
import { createContext } from '../context.ts'
import { emit, emitFailure } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, load, resolveGame, stage, type Workspace } from '../workspace.ts'

type Options = {
  id?: string
  provider?: string
  all?: boolean
  covers?: boolean
}

const KNOWN_PROVIDERS = ['igdb', 'rawg'] as const

function createProvider(name: string, root: string): Provider {
  if (name === 'igdb') return createIgdbProvider(root)
  if (name === 'rawg') return createRawgProvider(root)
  throw new GameregError('usage', 'error.enum', { field: 'provider', value: name, valid: KNOWN_PROVIDERS.join(', ') })
}

/** No `--provider`: try every known provider in order, igdb first, rawg as fallback. */
function providerChain(root: string, requested: string | undefined): Provider[] {
  if (requested !== undefined) return [createProvider(requested, root)]
  return KNOWN_PROVIDERS.map((name) => createProvider(name, root))
}

/**
 * The same auto-resolution threshold as local resolution (03-resolution.md):
 * exactly one result, and its normalized title matches exactly. Anything
 * short of that is a skip, never a guess — a wrong auto-enrich attaches the
 * wrong game's history to this one.
 */
export async function findDetail(provider: Provider, game: GameState): Promise<ProviderDetail | null> {
  const known = game.providers[provider.name]
  if (known !== undefined) return provider.fetch(String(known))

  const needle = normalize(game.title)
  const candidates = await provider.search(game.title)
  const matches = candidates.filter((candidate) => normalize(candidate.title) === needle)
  if (matches.length !== 1) return null
  return provider.fetch(matches[0]!.id)
}

export type EnrichOutcome =
  | { kind: 'enriched'; provider: string }
  | { kind: 'skipped' }
  | { kind: 'failed'; message: string }

export async function enrichGame(
  cli: Cli,
  workspace: Workspace,
  game: GameState,
  providers: readonly Provider[],
  covers: boolean,
): Promise<EnrichOutcome> {
  // Whether at least one provider actually answered — reachable, credentials
  // present — regardless of whether it found a match. A provider that is
  // merely unconfigured (the common case: most vaults set up only one) must
  // never turn "the working provider found nothing" into a reported failure.
  let attempted = false
  const failures: string[] = []

  for (const provider of providers) {
    let detail: ProviderDetail | null
    try {
      detail = await findDetail(provider, game)
      attempted = true
    } catch (error) {
      if (error instanceof GameregError && error.code === 6) {
        failures.push(cli.t(error.key, error.params))
        continue
      }
      throw error
    }
    if (detail === null) continue

    stage(cli, workspace, 'game.enrich', {
      game_id: game.game_id,
      provider: provider.name,
      fields: { ...detail.fields, id: detail.id },
      ...(covers && detail.cover_url !== null ? { cover: detail.cover_url } : {}),
    })
    return { kind: 'enriched', provider: provider.name }
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
    .option('--all', registrar.t('help.opt.all_games'))
    .option('--covers', registrar.t('help.opt.covers'))
    .action(async (query: string | undefined, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      if (options.provider !== undefined && !(KNOWN_PROVIDERS as readonly string[]).includes(options.provider)) {
        throw new GameregError('usage', 'error.enum', {
          field: 'provider',
          value: options.provider,
          valid: KNOWN_PROVIDERS.join(', '),
        })
      }

      const targets: GameState[] =
        options.all === true
          ? [...workspace.state.games]
          : [await resolveGame(cli, workspace, query ?? null, { id: options.id, allowCreate: false })]

      const providers = providerChain(cli.vault.root, options.provider)
      const covers = options.covers === true

      const enriched: { game_id: string; title: string; provider: string }[] = []
      const skipped: { game_id: string; title: string }[] = []
      const failed: { game_id: string; title: string; message: string }[] = []

      for (const game of targets) {
        const outcome = await enrichGame(cli, workspace, game, providers, covers)
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
