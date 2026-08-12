/**
 * `Games.md` — one row per run, so replays appear separately
 * (docs/spec/04-derived.md).
 *
 * Sorted by `ended_on` descending, open runs first. Stated hours are marked, so
 * they are never confused with measured ones.
 */
import { formatHours } from '../core/duration.ts'
import type { GameState, RunState, VaultState } from '../core/fold.ts'
import type { DatePrecision } from '../core/vocab.ts'
import type { Translator } from '../i18n/index.ts'
import { spliceBlocks, wrapBlock, type BlockContent } from './markers.ts'

export const TABLE_BLOCK = 'table'

type Row = { game: GameState; run: RunState }

function rowsOf(state: VaultState): Row[] {
  const rows: Row[] = state.games.flatMap((game) => game.runs.map((run) => ({ game, run })))
  return rows.sort((left, right) => {
    if (left.run.open !== right.run.open) return left.run.open ? -1 : 1
    const key = `${left.run.ended_on ?? ''}|${left.run.run_id}`
    const other = `${right.run.ended_on ?? ''}|${right.run.run_id}`
    return key < other ? 1 : key > other ? -1 : 0
  })
}

function cell(value: string | number | null): string {
  if (value === null) return ''
  return String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/**
 * A date is shown only as precisely as it was recorded: `2011` with year
 * precision stays `2011`, because `2011-01-01` is a lie.
 */
function date(value: string | null, precision: DatePrecision | null): string {
  if (value === null) return ''
  if (precision === 'year') return value.slice(0, 4)
  if (precision === 'month') return value.slice(0, 7)
  return value
}

export function tableBlock(state: VaultState, bundle: Translator): string {
  const rows = rowsOf(state)
  if (rows.length === 0) return bundle.t('table.empty')

  const head = [
    bundle.t('table.game'),
    bundle.t('table.platform'),
    bundle.t('table.started'),
    bundle.t('table.ended'),
    bundle.t('table.hours'),
    bundle.t('table.rating'),
    bundle.t('table.difficulty'),
    bundle.t('table.criteria'),
  ]

  const body = rows.map(({ game, run }) => {
    const hours =
      run.hours_source === 'stated'
        ? `${formatHours(run.minutes)} (${bundle.t('table.stated_marker')})`
        : formatHours(run.minutes)
    return [
      `[[${game.slug}\\|${cell(game.title)}]]`,
      cell(run.platform),
      date(run.started_on, run.started_precision),
      date(run.ended_on, run.ended_precision),
      hours,
      cell(run.rating),
      cell(run.difficulty),
      cell(run.completion_criteria),
    ]
  })

  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...body.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n')
}

export function blocksOf(state: VaultState, bundle: Translator): BlockContent[] {
  return [{ block: TABLE_BLOCK, content: tableBlock(state, bundle) }]
}

export function renderTable(existing: string | null, state: VaultState, bundle: Translator, file: string): string {
  const blocks = blocksOf(state, bundle)
  if (existing === null || existing.trim() === '') {
    return `# ${bundle.t('table.title')}\n\n${wrapBlock(TABLE_BLOCK, tableBlock(state, bundle))}\n`
  }
  const spliced = spliceBlocks(existing, blocks, file)
  return spliced.endsWith('\n') ? spliced : `${spliced}\n`
}
