/**
 * The interactive presenter (docs/spec/03-resolution.md "Consumers").
 *
 * It consumes the same candidate array a JSON caller receives — a bug in
 * ranking is visible in both or in neither. When a choice resolves, the command
 * continues in-process and exits 0; the user is never asked to retype it.
 */
import { select } from '@inquirer/prompts'

import { GameregError } from '../core/errors.ts'
import type { Candidate } from '../resolve/resolve.ts'
import type { Cli } from './context.ts'

export type Choice = { kind: 'candidate'; ref: string } | { kind: 'create' }

function describe(cli: Cli, candidate: Candidate): string {
  const year = candidate.year === null ? '' : ` (${candidate.year})`
  if (candidate.in_log) {
    return cli.t('prompt.candidate_local', {
      title: candidate.title,
      year,
      status: cli.label('status', candidate.status ?? 'unplayed'),
    })
  }
  // Two provider entries can share the exact title and year (a catalog
  // often has one entry per platform release) — platforms is what actually
  // tells them apart in the menu.
  const platforms = candidate.platforms.length === 0 ? '' : ` [${candidate.platforms.join(', ')}]`
  return cli.t('prompt.candidate_new', { title: candidate.title, year, platforms })
}

export async function choose(
  cli: Cli,
  query: string,
  candidates: readonly Candidate[],
  allowCreate: boolean,
): Promise<Choice> {
  const options: { name: string; value: Choice }[] = candidates.map((candidate) => ({
    name: describe(cli, candidate),
    value: { kind: 'candidate', ref: candidate.ref },
  }))
  if (allowCreate) {
    options.push({ name: cli.t('prompt.create_new', { query }), value: { kind: 'create' } })
  }

  try {
    return await select<Choice>({ message: cli.t('prompt.choose'), choices: options })
  } catch {
    throw new GameregError('usage', 'prompt.cancelled')
  }
}
