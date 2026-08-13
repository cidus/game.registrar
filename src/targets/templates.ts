/**
 * Files shipped with the tool and seeded into a vault (`templates/`).
 *
 * Reading these is reading the installation, not the vault — the same thing
 * `i18n/` does on every command. The rule a target obeys is that it never reads
 * *the vault*: not its own previous output, not another target's, not anything
 * a build wrote. A shipped default is part of the program.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { GameregError } from '../core/errors.ts'

const TEMPLATES = 'templates'

function templatesDir(): string {
  let current = import.meta.dirname
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, TEMPLATES)
    if (existsSync(candidate)) return resolve(candidate)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new GameregError('error', 'error.missing_template', { name: TEMPLATES })
}

export function template(name: string): string {
  const file = join(templatesDir(), name)
  if (!existsSync(file)) throw new GameregError('error', 'error.missing_template', { name })
  return readFileSync(file, 'utf8')
}
