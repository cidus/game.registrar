/**
 * The query guard (docs/spec/02-cli.md "gamereg query <sql>") — a security
 * boundary, tested by what it refuses first. Per CLAUDE.md's testing
 * strategy: multiple statements, PRAGMA, ATTACH, comments hiding a second
 * statement, WITH ... DELETE.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { checkReadOnlySelect } from '../src/db/guard.ts'

function accepts(sql: string): void {
  assert.doesNotThrow(() => checkReadOnlySelect(sql))
}

function refuses(sql: string, pattern: RegExp): void {
  assert.throws(() => checkReadOnlySelect(sql), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, pattern)
    return true
  })
}

test('a plain SELECT is accepted', () => {
  accepts('SELECT * FROM games')
  accepts('select title, rating from runs where outcome = "finished"')
})

test('a trailing semicolon on a single statement is fine', () => {
  accepts('SELECT 1;')
  accepts('SELECT 1;   ')
})

test('a CTE that ends in SELECT is accepted', () => {
  accepts('WITH recent AS (SELECT * FROM runs) SELECT * FROM recent')
})

test('multiple statements are refused', () => {
  refuses('SELECT 1; SELECT 2;', /error\.query_multiple_statements/)
  refuses('SELECT 1; DROP TABLE games;', /error\.query_multiple_statements/)
})

test('PRAGMA is refused, even alone', () => {
  refuses('PRAGMA journal_mode=WAL', /error\.query_not_select/)
})

test('the reserved sqlite_ and pragma_ namespaces are refused', () => {
  // `\b` does not separate `pragma` from `_table_info`, because `_` is a word
  // character -- so this passed every check the guard made and executed.
  // Read-only, so nothing was writable through it, but the boundary is stated
  // without exception and `query --schema` answers the same question.
  refuses("SELECT * FROM pragma_table_info('games')", /error\.query_forbidden/)
  refuses("SELECT * FROM PRAGMA_TABLE_INFO('games')", /error\.query_forbidden/)
  // No paren: this one takes no arguments and is spelled without one.
  refuses('SELECT * FROM pragma_database_list', /error\.query_forbidden/)
  refuses('SELECT name FROM sqlite_schema', /error\.query_forbidden/)
  refuses('SELECT name FROM sqlite_master', /error\.query_forbidden/)
})

test('the reported keyword names the function, not the paren that identified it', () => {
  assert.throws(
    () => checkReadOnlySelect("SELECT * FROM pragma_table_info('games')"),
    (error: unknown) => (error as { params?: { keyword?: string } }).params?.keyword === 'pragma_table_info',
  )
})

test('a name that merely contains the prefix mid-identifier is still allowed', () => {
  // The namespace is reserved at the start of an identifier only, so a column
  // gamereg could plausibly emit is unaffected.
  accepts('SELECT my_pragma_note FROM games')
  accepts("SELECT * FROM games WHERE title = 'pragma_table_info'")
})

test('ATTACH is refused', () => {
  refuses("ATTACH DATABASE 'x.db' AS x", /error\.query_not_select/)
})

test('a comment cannot hide a second statement from the check', () => {
  refuses('SELECT 1; -- harmless looking\nPRAGMA busy_timeout=1', /error\.query_multiple_statements/)
  refuses('SELECT 1 /* */; DELETE FROM games;', /error\.query_multiple_statements/)
})

test('a block comment containing SQL-looking text inside one statement is still one statement', () => {
  accepts('SELECT 1 /* ; DROP TABLE games; */')
})

test('WITH ... DELETE is refused even though it starts with WITH', () => {
  refuses('WITH x AS (SELECT 1) DELETE FROM games', /error\.query_forbidden/)
})

test('INSERT, UPDATE, DROP, ALTER, CREATE, VACUUM, REINDEX, and transaction control are all refused', () => {
  refuses('INSERT INTO games (game_id) VALUES (1)', /error\.query_not_select/)
  refuses('UPDATE games SET title = 1', /error\.query_not_select/)
  refuses('SELECT * FROM games; DROP TABLE games;', /error\.query_multiple_statements/)
  refuses('DROP TABLE games', /error\.query_not_select/)
  refuses('ALTER TABLE games ADD COLUMN x TEXT', /error\.query_not_select/)
  refuses('CREATE TABLE x (a INTEGER)', /error\.query_not_select/)
  refuses('VACUUM', /error\.query_not_select/)
  refuses('REINDEX', /error\.query_not_select/)
  refuses('BEGIN', /error\.query_not_select/)
  refuses('SELECT * FROM games; COMMIT;', /error\.query_multiple_statements/)
})

test('a keyword appearing only inside a string literal does not trip the forbidden scan', () => {
  accepts("SELECT 'please delete this later' AS note")
  accepts('SELECT title FROM games WHERE title = \'DROP TABLE\'')
})

test('a keyword appearing inside a quoted identifier does not trip the forbidden scan', () => {
  accepts('SELECT "delete" FROM games')
})

test('empty or whitespace-only input is refused', () => {
  refuses('', /error\.query_empty/)
  refuses('   ', /error\.query_empty/)
  refuses(';', /error\.query_empty/)
})

test('an unterminated string literal does not crash the guard', () => {
  // The guard neutralizes it and lets it through; SQLite itself rejects the
  // malformed statement at execution time (query.ts, error.query_failed).
  assert.doesNotThrow(() => checkReadOnlySelect("SELECT 'unterminated"))
})
