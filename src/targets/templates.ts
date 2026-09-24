/**
 * Files shipped with the tool and seeded into a vault (`templates/`).
 *
 * Reading these is reading the installation, not the vault — the same thing
 * `i18n/` does on every command. The rule a target obeys is that it never reads
 * *the vault*: not its own previous output, not another target's, not anything
 * a build wrote. A shipped default is part of the program.
 *
 * A template is a literal with **named holes**: `{{base.view.finished}}` is
 * filled from `i18n/` when the file is planned. There is no per-locale copy of
 * a template, and there must not be — a second structural copy of the same
 * file is the drift ADR 0019 records, and a view added to the English one
 * would silently not exist in the others.
 *
 * Two properties of the substitution earn their complexity:
 *
 * - **A hole is filled with a serialized YAML scalar**, never pasted raw. Both
 *   templates are YAML, and a seed is written once and never repaired: a
 *   translation carrying `: `, opening with `#` or `*`, or spelling a YAML 1.1
 *   boolean (`No`, `On`) would corrupt the file silently and permanently.
 * - **An unfillable hole is a hard error.** Emitting the hole would write
 *   `{{base.view.shelf}}` into somebody's vault for good.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stringify } from 'yaml'

import { GameregError } from '../core/errors.ts'
import type { Translator } from '../i18n/index.ts'

const TEMPLATES = 'templates'

/** A hole, and the only thing substituted. Keys look like `base.view.shelf`. */
const HOLE = /\{\{([a-z0-9_.]+)\}\}/g

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

export function template(name: string, bundle: Translator): string {
  const file = join(templatesDir(), name)
  if (!existsSync(file)) throw new GameregError('error', 'error.missing_template', { name })
  const source = readFileSync(file, 'utf8')

  return source.replace(HOLE, (_whole, key: string) => {
    if (!bundle.has(key)) {
      throw new GameregError('error', 'error.template_placeholder', { name, key })
    }
    // The scalar as YAML would write it, and nothing more: `Finished` stays
    // plain, `Concluído: sim` gains the quotes it needs.
    return stringify(bundle.t(key), { lineWidth: 0 }).trimEnd()
  })
}
