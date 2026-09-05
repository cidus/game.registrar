/**
 * `dumpDatabase` as a command, for the container workflow's clean-room check.
 *
 * It exists so that check can call the *same* function `test/golden.test.ts`
 * compares with, rather than a second implementation of it. The first draft of
 * the workflow carried its own copy, and the copy was already wrong in three
 * ways nothing would have caught: `JSON.stringify` throws on a bigint, renders
 * a BLOB as an object of numbered keys where `sqlValue` renders hex, and
 * writes `null` where it writes `NULL`. The fixture happens to contain none of
 * those today, so it passed -- which is what a silent copy looks like right up
 * until it does not.
 *
 * Not a test, and deliberately not named like one: `npm test` globs
 * `test/**\/*.test.ts`, so this is never collected. It lives here anyway
 * because it is a thin shell over a test helper and belongs where that helper
 * is typechecked.
 */
import { dumpDatabase } from './helpers.ts'

const file = process.argv[2]
if (file === undefined) {
  console.error('usage: node test/dump-db.ts <path to log.db>')
  process.exit(2)
}

process.stdout.write(dumpDatabase(file))
