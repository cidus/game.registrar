/**
 * A lock against two `gamereg build` processes writing the same vault at once
 * (docs/spec/07-targets.md). Planning is pure and never touches disk — the
 * writer does, via a direct `writeFileSync` with no rename-into-place — so
 * two overlapping builds can genuinely tear a file mid-write, `data/log.db`
 * most of all: a concurrent `gamereg query` opening it in that window can see
 * a file SQLite does not recognize as a database at all.
 *
 * A plain lockfile, not a library: `open(path, 'wx')` is atomic at the OS
 * level (fails if the file already exists), which is the one guarantee this
 * needs. The file holds the holder's PID so a build that starts after a crash
 * — the process killed, the machine restarted, cleanup skipped — can tell a
 * stale lock from a live one and proceed instead of jamming forever.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

import { conflict } from '../core/errors.ts'
import type { Vault } from '../core/vault.ts'

/** ESRCH (no such process) means stale; EPERM means alive but not ours to signal. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** `null` for a missing, empty or corrupt lock file — treated as stale, never guessed at. */
function holderPid(file: string): number | null {
  if (!existsSync(file)) return null
  try {
    const pid = Number.parseInt(readFileSync(file, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function createExclusive(file: string): number | null {
  try {
    return openSync(file, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null
    throw error
  }
}

/**
 * Acquires the build lock, or throws `error.build_in_progress` (code 5) when
 * a live process already holds it. A lock left by a process that no longer
 * exists is stale and is cleared automatically before retrying once.
 *
 * Returns a release function. Call it in a `finally` — an unreleased lock is
 * indistinguishable from a build that is still genuinely running, and the
 * next one will wait out the full staleness check for nothing.
 */
export function acquireBuildLock(vault: Vault): () => void {
  const file = vault.lockFile
  mkdirSync(dirname(file), { recursive: true })

  let fd = createExclusive(file)
  if (fd === null) {
    const pid = holderPid(file)
    if (pid !== null && isAlive(pid)) {
      throw conflict('error.build_in_progress', { pid })
    }
    rmSync(file, { force: true })
    fd = createExclusive(file)
    if (fd === null) {
      // Lost a race with another build also recovering the same stale lock.
      throw conflict('error.build_in_progress', { pid: holderPid(file) ?? 0 })
    }
  }

  writeSync(fd, String(process.pid))
  closeSync(fd)

  let released = false
  return () => {
    if (released) return
    released = true
    rmSync(file, { force: true })
  }
}
