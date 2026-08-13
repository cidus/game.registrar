/**
 * A date is shown only as precisely as it was recorded (docs/spec/01-model.md):
 * `2011` at year precision stays `2011`, because `2011-01-01` is a lie that
 * pollutes every chart it reaches.
 *
 * Frontmatter is the exception and keeps the stored value whole, alongside the
 * `date_precision` field that says how much of it to believe.
 */
import type { DatePrecision } from '../core/vocab.ts'

export function atPrecision(value: string, precision: DatePrecision | null): string {
  if (precision === 'year') return value.slice(0, 4)
  if (precision === 'month') return value.slice(0, 7)
  return value
}
