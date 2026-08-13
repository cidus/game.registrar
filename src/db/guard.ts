/**
 * The query guard (docs/spec/02-cli.md "gamereg query <sql>").
 *
 * A security boundary, not a SQL parser: `gamereg query` executes against
 * `data/log.db` with no application-level authorization of its own, so
 * *this* is what stands between "read-only reporting tool" and "arbitrary
 * write access to the cache". It must be tested by what it refuses, not only
 * by what it accepts.
 *
 * Strategy: neutralize string/blob literals, quoted identifiers and comments
 * first — so neither a keyword sitting inside a string nor SQL hidden inside
 * a comment can confuse the checks that follow — then require exactly one
 * statement, starting with SELECT or WITH, and containing no mutating or
 * transaction-control keyword anywhere. `WITH x AS (...) DELETE ...` is
 * legal SQLite and starts with WITH, which is why the keyword scan runs
 * across the whole statement rather than only checking the first token.
 */
import { GameregError } from '../core/errors.ts'

const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex|trigger|begin|commit|rollback|savepoint|release|analyze)\b/i

const ALLOWED_START = /^(select|with)\b/i

/**
 * Replaces string literals, quoted identifiers and comments with inert
 * placeholders of the same general shape, so statement-splitting and the
 * keyword scan never see their contents.
 */
function neutralize(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]!
    const next = sql[i + 1]

    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end + 1
      out += ' '
      continue
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
      continue
    }
    if (c === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2
          continue
        }
        if (sql[j] === "'") {
          j += 1
          break
        }
        j += 1
      }
      out += "''"
      i = j
      continue
    }
    if (c === '"' || c === '`') {
      let j = i + 1
      while (j < sql.length && sql[j] !== c) j += 1
      out += `${c}${c}`
      i = Math.min(j + 1, sql.length)
      continue
    }
    if (c === '[') {
      const end = sql.indexOf(']', i)
      i = end === -1 ? sql.length : end + 1
      out += '[]'
      continue
    }

    out += c
    i += 1
  }
  return out
}

/** Throws unless `sql` is exactly one read-only SELECT. Never executes anything. */
export function checkReadOnlySelect(sql: string): void {
  const neutralized = neutralize(sql)
  const statements = neutralized
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')

  if (statements.length === 0) {
    throw new GameregError('usage', 'error.query_empty')
  }
  if (statements.length > 1) {
    throw new GameregError('usage', 'error.query_multiple_statements')
  }

  const statement = statements[0]!
  if (!ALLOWED_START.test(statement)) {
    throw new GameregError('usage', 'error.query_not_select')
  }
  if (FORBIDDEN_KEYWORDS.test(statement)) {
    const match = statement.match(FORBIDDEN_KEYWORDS)
    throw new GameregError('usage', 'error.query_forbidden', { keyword: match?.[0]?.toLowerCase() ?? '' })
  }
}
