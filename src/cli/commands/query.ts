/**
 * `gamereg query <sql>` — read-only SQL over `data/log.db` (docs/spec/02-cli.md).
 *
 * Never writes: this is how question-answering works, the database does the
 * arithmetic, and no number is ever hallucinated. `data/log.db` is a cache
 * (00-architecture.md invariant 10) — only `gamereg build sqlite` writes it,
 * this command only reads.
 *
 * `--schema` reports what there is to query. It exists for the agent
 * (docs/spec/05-agent.md, *Questions*): a caller that has to write SQL needs
 * the column names, and one that asks the database for them cannot drift from
 * the schema the way a copy pasted into a prompt does.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { checkReadOnlySelect } from '../../db/guard.ts'
import { createContext, type Cli } from '../context.ts'
import { emit } from '../output.ts'
import type { Registrar } from '../register.ts'

/** JSON has no bigint; node:sqlite may return one for an INTEGER outside the safe range. */
function toJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  }
  if (Buffer.isBuffer(value)) return value.toString('base64')
  return value
}

type Relation = { name: string; columns: { name: string; type?: string }[] }

/**
 * Tables and views with their columns, read from the database rather than
 * parsed out of `db/schema.ts`. A view's columns are decided by its SELECT
 * list — the aliases, the `ROUND(...)` expressions — and only SQLite itself
 * knows them without re-implementing half a parser. `PRAGMA table_info`
 * answers for views as well as tables.
 *
 * The guard in `db/guard.ts` refuses PRAGMA, as it should: it is the boundary
 * for SQL that arrived from outside. This query is not that — it is a fixed
 * statement on a read-only connection.
 */
function readSchema(db: DatabaseSync): { tables: Relation[]; views: Relation[] } {
  const relations = db
    .prepare(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all() as { name: string; type: string }[]

  // A computed view column (`ROUND(...) AS hours`) has no declared type, and
  // SQLite reports an empty string for it. Report the absence as an absence.
  const describe = (name: string): Relation => ({
    name,
    columns: (db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all() as {
      name: string
      type: string
    }[]).map((column) => (column.type === '' ? { name: column.name } : { name: column.name, type: column.type })),
  })

  return {
    tables: relations.filter((r) => r.type === 'table').map((r) => describe(r.name)),
    views: relations.filter((r) => r.type === 'view').map((r) => describe(r.name)),
  }
}

function openLogDb(cli: Cli): DatabaseSync {
  const file = join(cli.vault.dataDir, 'log.db')
  if (!existsSync(file)) {
    throw new GameregError('usage', 'error.log_db_missing', { file: 'data/log.db' })
  }
  return new DatabaseSync(file, { readOnly: true })
}

export function registerQuery(registrar: Registrar): void {
  registrar
    .command('query', 'help.query')
    .argument('[sql]', registrar.t('help.arg.sql'))
    .option('--schema', registrar.t('help.opt.schema'))
    .action((sql: string | undefined, options: { schema?: boolean }, command: Command) => {
      const cli = createContext(command)

      if (options.schema === true) {
        if (sql !== undefined) {
          throw new GameregError('usage', 'error.query_schema_with_sql')
        }
        const db = openLogDb(cli)
        let schema: { tables: Relation[]; views: Relation[] }
        try {
          schema = readSchema(db)
        } finally {
          db.close()
        }
        const listing = (relations: Relation[]): string[] =>
          relations.map((r) => `  ${r.name}(${r.columns.map((c) => c.name).join(', ')})`)
        emit(cli, {
          action: 'query.schema',
          result: schema,
          events: [],
          prose: [
            cli.t('prose.query.schema_tables'),
            ...listing(schema.tables),
            cli.t('prose.query.schema_views'),
            ...listing(schema.views),
          ],
        })
        return
      }

      if (sql === undefined) {
        throw new GameregError('usage', 'error.query_empty')
      }

      checkReadOnlySelect(sql)

      const db = openLogDb(cli)
      let rows: Record<string, unknown>[]
      try {
        rows = db.prepare(sql).all() as Record<string, unknown>[]
      } catch (cause) {
        throw new GameregError('usage', 'error.query_failed', {
          message: cause instanceof Error ? cause.message : String(cause),
        })
      } finally {
        db.close()
      }

      const result = rows.map((row) => {
        const out: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(row)) out[key] = toJsonValue(value)
        return out
      })

      emit(cli, {
        action: 'query',
        result: { rows: result, count: result.length },
        events: [],
        prose:
          result.length === 0
            ? [cli.t('prose.query.none')]
            : [cli.t('prose.query.count', { count: result.length }), JSON.stringify(result, null, 2)],
      })
    })
}
