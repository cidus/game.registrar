/**
 * A SQLite file as comparable text, and a command that prints it.
 *
 * A leaf on purpose: `node:sqlite` and nothing else. `test/helpers.ts`
 * re-exports it for `test/golden.test.ts`, and the container workflow runs
 * this file directly to compare a clean-room build against the committed
 * goldens -- on a runner with no `node_modules`, which is why it must not
 * reach into `src/`.
 *
 * That constraint is the whole reason this is its own module. The workflow
 * first carried a private copy of the logic, which had already diverged in
 * three ways nothing would have caught: `JSON.stringify` throws on a bigint,
 * renders a BLOB as an object of numbered keys where this renders hex, and
 * writes `null` where this writes `NULL`. One implementation, two callers, no
 * mirror to hold.
 */
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return `x'${Buffer.from(value).toString('hex')}'`
  return JSON.stringify(value)
}

/**
 * A SQLite file as comparable text: its schema, then every table and view row
 * by row, one `column=value` line each.
 *
 * This exists because the same logical database is not the same bytes across
 * SQLite versions — Node v26.0.0 bundles 3.53.1 and v26.7.0 bundles 3.53.4,
 * and a file built by one differs from a file built by the other with no
 * difference in content. A committed fixture therefore cannot be compared byte
 * for byte by whoever happens to clone the repo, so it is compared through
 * this instead. Determinism is still asserted on the bytes themselves, where
 * both files come from one machine and one library version (the idempotency
 * test in golden.test.ts, and non-negotiable 2 in CLAUDE.md).
 *
 * Rows come out in each object's own order — for a table that is rowid, hence
 * the build's insertion order, which is deterministic by construction and part
 * of what the fixture freezes; for a view it is whatever the view's own SQL
 * defines. Neither is re-sorted here: a change in either is a real change in
 * the artifact and should show up as a diff.
 */
export function dumpDatabase(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    // `sqlite_%` skips the internal bookkeeping (autoindexes over the TEXT
    // primary keys, chiefly), which is exactly the layer that is free to
    // differ between library versions.
    const objects = db
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .all() as { type: string; name: string; sql: string | null }[]

    const lines: string[] = []
    for (const object of objects) {
      lines.push(`-- ${object.type} ${object.name}`, (object.sql ?? '').trim())
    }
    for (const object of objects) {
      if (object.type !== 'table' && object.type !== 'view') continue
      lines.push(`-- rows ${object.name}`)
      for (const row of db.prepare(`SELECT * FROM "${object.name}"`).all()) {
        lines.push(
          Object.entries(row as Record<string, unknown>)
            .map(([column, value]) => `${column}=${sqlValue(value)}`)
            .join(' | '),
        )
      }
    }
    return `${lines.join('\n')}\n`
  } finally {
    db.close()
  }
}

// Run directly (`node test/dump-db.ts <file>`) it is a command; imported it is
// just the function. `npm test` globs `test/**/*.test.ts`, so this is never
// collected as a test either way.
if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (file === undefined) {
    console.error('usage: node test/dump-db.ts <path to log.db>')
    process.exit(2)
  }
  process.stdout.write(dumpDatabase(file))
}
