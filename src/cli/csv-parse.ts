/**
 * A minimal RFC 4180 reader, for `gamereg import`. The inverse of
 * `targets/csv.ts`'s `encodeCsv`, but this one only needs to be permissive:
 * it reads whatever spreadsheet software actually exported, not only what
 * this tool would have written itself.
 */

/** One row per line after the header; each row is a plain object keyed by header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text)
  if (rows.length === 0) return []
  const [header, ...body] = rows
  return body
    .filter((row) => !(row.length === 1 && row[0] === ''))
    .map((row) => {
      const record: Record<string, string> = {}
      header!.forEach((name, index) => {
        record[name] = row[index] ?? ''
      })
      return record
    })
}

function parseRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const source = text.replace(/\r\n/g, '\n')

  while (i < source.length) {
    const char = source[i]!

    if (inQuotes) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"'
        i += 2
        continue
      }
      if (char === '"') {
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += char
    i += 1
  }

  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)

  return rows
}
