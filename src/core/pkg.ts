import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The installed version, read from the package manifest next to the sources. */
export function version(): string {
  let current = import.meta.dirname
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = join(current, 'package.json')
    if (existsSync(manifest)) {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) {
        const found = (parsed as Record<string, unknown>)['version']
        if (typeof found === 'string') return found
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return '0.0.0'
}
