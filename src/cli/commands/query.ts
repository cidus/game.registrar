/**
 * `gamereg query <sql>` — read-only SQL over `data/log.db` (docs/spec/02-cli.md).
 *
 * Never writes: this is how question-answering works, the database does the
 * arithmetic, and no number is ever hallucinated. `data/log.db` is a cache
 * (00-architecture.md invariant 10) — only `gamereg build sqlite` writes it,
 * this command only reads.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'

import { GameregError } from '../../core/errors.ts'
import { checkReadOnlySelect } from '../../db/guard.ts'
import { createContext } from '../context.ts'
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

export function registerQuery(registrar: Registrar): void {
  registrar
    .command('query', 'help.query')
    .argument('<sql>', registrar.t('help.arg.sql'))
    .action((sql: string, _options: unknown, command: Command) => {
      const cli = createContext(command)

      checkReadOnlySelect(sql)

      const file = join(cli.vault.dataDir, 'log.db')
      if (!existsSync(file)) {
        throw new GameregError('usage', 'error.log_db_missing', { file: 'data/log.db' })
      }

      const db = new DatabaseSync(file, { readOnly: true })
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
