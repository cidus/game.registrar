/**
 * `.gamereg/manifest.json` — build bookkeeping (docs/spec/07-targets.md).
 *
 * Records which files each target wrote, so that a file previously owned by a
 * target and no longer planned by it can be removed. This is the only part of
 * the build that deletes, and the only file the build reads back. No target may
 * read it: it holds no state the log does not already imply, and it is
 * reconstructible by rebuilding.
 *
 * `seeds` are tracked separately from `files` because a seed is never removed —
 * once a `.base` exists it is the user's. Keeping the two lists apart makes that
 * guarantee structural rather than a condition someone has to remember.
 *
 * It is data, so it obeys the determinism rules: vault-relative paths, forward
 * slashes, keys and lists sorted, LF, one trailing newline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const MANIFEST_SCHEMA = 1

export type TargetOwnership = {
  files: string[]
  seeds: string[]
}

export type Manifest = {
  schema: number
  targets: Record<string, TargetOwnership>
}

export function emptyManifest(): Manifest {
  return { schema: MANIFEST_SCHEMA, targets: {} }
}

const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort()

function ownershipOf(value: unknown): TargetOwnership | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entry = value as Record<string, unknown>
  const list = (key: string): string[] => {
    const found = entry[key]
    if (!Array.isArray(found)) return []
    return found.filter((item): item is string => typeof item === 'string')
  }
  return { files: sorted(list('files')), seeds: sorted(list('seeds')) }
}

/**
 * `null` when the manifest is missing or unreadable, which is not an error: the
 * build writes everything, creates a new one, and skips cleanup for that run.
 * Ownership is never reconstructed by guessing from filenames.
 */
export function readManifest(file: string): Manifest | null {
  if (!existsSync(file)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const source = parsed as Record<string, unknown>
  const targets = source['targets']
  if (typeof targets !== 'object' || targets === null || Array.isArray(targets)) return null

  const manifest = emptyManifest()
  for (const [name, value] of Object.entries(targets as Record<string, unknown>)) {
    const ownership = ownershipOf(value)
    if (ownership !== null) manifest.targets[name] = ownership
  }
  return manifest
}

export function serializeManifest(manifest: Manifest): string {
  const targets: Record<string, Record<string, string[]>> = {}
  for (const name of Object.keys(manifest.targets).sort()) {
    const ownership = manifest.targets[name]
    if (ownership === undefined) continue
    const entry: Record<string, string[]> = { files: sorted(ownership.files) }
    if (ownership.seeds.length > 0) entry['seeds'] = sorted(ownership.seeds)
    targets[name] = entry
  }
  return `${JSON.stringify({ schema: MANIFEST_SCHEMA, targets }, null, 2)}\n`
}

export function writeManifest(file: string, manifest: Manifest): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, serializeManifest(manifest), 'utf8')
}

/** Every file the manifest holds a target responsible for, seeds included. */
export function ownedPaths(manifest: Manifest | null): Set<string> {
  const paths = new Set<string>()
  if (manifest === null) return paths
  for (const ownership of Object.values(manifest.targets)) {
    for (const path of ownership.files) paths.add(path)
    for (const path of ownership.seeds) paths.add(path)
  }
  return paths
}
