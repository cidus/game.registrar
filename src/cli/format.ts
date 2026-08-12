/** Small presentation helpers shared by the prose emitters. */
import type { DateTime } from 'luxon'

import { parseISO } from '../core/time.ts'
import type { Cli } from './context.ts'

export function clock(instant: DateTime): string {
  return instant.toFormat('HH:mm')
}

export function clockOf(cli: Cli, iso: string): string {
  return clock(parseISO(iso, cli.time))
}

export function list(values: readonly string[]): string {
  return values.join(', ')
}
