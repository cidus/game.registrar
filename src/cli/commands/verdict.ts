/**
 * `gamereg verdict <query>` — file the consolidated review (docs/spec/02-cli.md).
 *
 * The text comes from `-m`, from a file, or from stdin, and the register does
 * not record which — nor whether a person or a model composed it. Prose enters
 * as content, never as structured fields.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import type { GameState, RunState } from '../../core/fold.ts'
import { createContext } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, load, resolveGame, stage } from '../workspace.ts'

type Options = {
  id?: string
  run?: string
  message?: string
  text?: string
}

/**
 * The most recently ended run, falling back to the open one. A verdict written
 * right after `finish` lands on the run it is about, even when a replay has
 * already started.
 */
function targetRun(game: GameState, requested: string | undefined): RunState {
  if (requested !== undefined) {
    const named = game.runs.find((run) => run.run_id === requested)
    if (named === undefined) {
      throw new GameregError('not_found', 'error.unknown_run', { id: requested, title: game.title })
    }
    return named
  }

  const ended = game.runs.filter((run) => run.ended_on !== null)
  const last = ended.sort((left, right) => {
    const key = `${left.ended_on ?? ''}|${left.run_id}`
    const other = `${right.ended_on ?? ''}|${right.run_id}`
    return key < other ? -1 : key > other ? 1 : 0
  })[ended.length - 1]

  const run = last ?? game.runs.find((entry) => entry.open) ?? null
  if (run === null) throw new GameregError('conflict', 'error.no_run', { title: game.title })
  return run
}

function readText(options: Options): string {
  if (options.message !== undefined) return options.message

  if (options.text !== undefined && options.text !== '-') {
    if (!existsSync(options.text)) {
      throw new GameregError('not_found', 'error.text_file', { file: options.text })
    }
    return readFileSync(options.text, 'utf8')
  }

  // `--text -`, or nothing at all when stdin is a pipe.
  if (options.text === '-' || process.stdin.isTTY !== true) {
    try {
      return readFileSync(0, 'utf8')
    } catch {
      throw new GameregError('usage', 'error.text_required')
    }
  }

  throw new GameregError('usage', 'error.text_required')
}

export function registerVerdict(registrar: Registrar): void {
  registrar
    .command('verdict', 'help.verdict')
    .argument('<query>', registrar.t('help.arg.query'))
    .option('-m, --message <text>', registrar.t('help.opt.message'))
    .option('--text <file>', registrar.t('help.opt.text'))
    .option('--run <run_id>', registrar.t('help.opt.run'))
    .option('--id <ref>', registrar.t('help.opt.id'))
    .action(async (query: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const resolved = await resolveGame(cli, workspace, query, {
        id: options.id,
        allowCreate: false,
      })
      const gameId = resolved.game_id
      const run = targetRun(resolved, options.run)

      const text = readText(options).trim()
      if (text === '') throw new GameregError('usage', 'error.text_required')

      const replaced = run.verdict !== null
      stage(cli, workspace, 'run.verdict', { run_id: run.run_id, text })
      const events = commit(cli, workspace)
      const game = workspace.state.gamesById.get(gameId)!

      emit(cli, {
        action: 'run.verdict',
        result: {
          game: { game_id: game.game_id, slug: game.slug, title: game.title },
          run_id: run.run_id,
          characters: text.length,
          replaced,
        },
        events,
        prose: [cli.t(replaced ? 'prose.verdict.replaced' : 'prose.verdict.filed', { title: game.title })],
      })
    })
}
