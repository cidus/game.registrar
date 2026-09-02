/**
 * `gamereg import <file.csv> --mapping <file.json>` — bulk historical import
 * (docs/spec/02-cli.md).
 *
 * One `run.import` per row, filed through the same path as `gamereg past`
 * (cli/historical-run.ts) — a row from a spreadsheet and a game typed in by
 * hand produce an identical event once they land in the log. `--dry-run` is
 * the recommended way to see what a mapping produces before committing it.
 *
 * A row that fails to resolve or validate does not stop the ones after it —
 * the same principle `build` and `enrich` use for a partial failure:
 * everything that worked is written, and the exit code says something did
 * not.
 */
import { readFileSync } from 'node:fs'
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { parseCsv } from '../csv-parse.ts'
import { createContext } from '../context.ts'
import { fileHistoricalRun, type HistoricalRunInput } from '../historical-run.ts'
import { emit, emitFailure } from '../output.ts'
import type { Registrar } from '../register.ts'
import { commit, load, stage } from '../workspace.ts'

type Options = { mapping: string }

/** Mapping keys are gamereg field names; values are the CSV's own column headers. */
const REQUIRED_FIELDS = ['title', 'ended'] as const
const OPTIONAL_FIELDS = [
  'started',
  'hours',
  'rating',
  'difficulty',
  'criteria',
  'outcome',
  'platform',
  'form',
  'mode',
  'note',
  'verdict',
] as const
const MAPPING_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as const

type MappingField = (typeof MAPPING_FIELDS)[number]
type Mapping = Partial<Record<MappingField, string>>

function readJsonFile(file: string): unknown {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    throw new GameregError('usage', 'error.text_file', { file }, { cause })
  }
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new GameregError('usage', 'error.bad_config', { file }, { cause })
  }
}

function loadMapping(file: string): Mapping {
  const parsed = readJsonFile(file)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GameregError('usage', 'error.bad_config', { file })
  }
  const source = parsed as Record<string, unknown>
  const mapping: Mapping = {}
  for (const field of MAPPING_FIELDS) {
    const column = source[field]
    if (typeof column === 'string' && column !== '') mapping[field] = column
  }
  for (const missing of REQUIRED_FIELDS) {
    if (mapping[missing] === undefined) {
      throw new GameregError('usage', 'error.import_mapping_incomplete', { field: missing, file })
    }
  }
  return mapping
}

function rowInput(
  row: Record<string, string>,
  mapping: Mapping,
): { input: HistoricalRunInput; verdict?: string } {
  const value = (field: MappingField): string | undefined => {
    const column = mapping[field]
    if (column === undefined) return undefined
    const raw = row[column]
    return raw === undefined || raw.trim() === '' ? undefined : raw.trim()
  }

  const title = value('title')
  const ended = value('ended')
  if (title === undefined || ended === undefined) {
    throw new GameregError('usage', 'error.import_row_incomplete', {
      field: title === undefined ? 'title' : 'ended',
    })
  }

  return {
    input: {
      query: title,
      ended,
      started: value('started'),
      hours: value('hours'),
      rating: value('rating'),
      difficulty: value('difficulty'),
      criteria: value('criteria'),
      outcome: value('outcome'),
      platform: value('platform'),
      form: value('form'),
      mode: value('mode'),
      note: value('note'),
      // A bulk historical import never prompts and never touches a provider —
      // an unmatched title becomes a new local entry, the same escape hatch
      // `--no-metadata` gives a single `past` call.
      metadata: false,
    },
    verdict: value('verdict'),
  }
}

export function registerImport(registrar: Registrar): void {
  registrar
    .command('import', 'help.import')
    .argument('<file>', registrar.t('help.arg.csv_file'))
    .requiredOption('--mapping <file>', registrar.t('help.opt.mapping'))
    .action(async (file: string, options: Options, command: Command) => {
      const cli = createContext(command)
      const workspace = load(cli)

      const mapping = loadMapping(options.mapping)
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch (cause) {
        throw new GameregError('usage', 'error.text_file', { file }, { cause })
      }
      const rows = parseCsv(text)

      const imported: { row: number; game_id: string; run_id: string; title: string }[] = []
      const failed: { row: number; message: string }[] = []

      for (const [index, row] of rows.entries()) {
        const lineNumber = index + 2 // header is line 1
        try {
          const { input, verdict } = rowInput(row, mapping)
          const { game, run } = await fileHistoricalRun(
            cli,
            workspace,
            input,
            { attachments: [], photos: [], suggestedAt: null },
            false,
          )
          if (verdict !== undefined) stage(cli, workspace, 'run.verdict', { run_id: run.run_id, text: verdict })
          imported.push({ row: lineNumber, game_id: game.game_id, run_id: run.run_id, title: game.title })
        } catch (error) {
          const message = error instanceof GameregError ? cli.t(error.key, error.params) : String(error)
          failed.push({ row: lineNumber, message })
        }
      }

      const events = commit(cli, workspace)
      const payload = { imported, failed }

      if (failed.length > 0) {
        process.exitCode = emitFailure(
          cli,
          new GameregError(
            'error',
            'prose.import.failed_count',
            { count: failed.length },
            { details: { error: 'import_row_failed', result: payload } },
          ),
        )
        if (!cli.json && !cli.quiet) {
          for (const entry of failed) process.stderr.write(`${cli.t('prose.import.failed', entry)}\n`)
        }
        return
      }

      emit(cli, {
        action: 'run.import',
        result: payload,
        events,
        prose: [cli.t('prose.import.done', { count: imported.length })],
      })
    })
}
