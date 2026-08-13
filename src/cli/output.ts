/**
 * The output contract (docs/spec/02-cli.md).
 *
 *   success: { "ok": true, "action": "...", "result": {...}, "events": ["01K…"] }
 *   failure: { "ok": false, "code": 3, "error": "ambiguous", "message": "...", ... }
 *
 * `ok` is always present. Machine callers branch on `code`, never on `message`.
 * The Registrar's voice lives in prose only; it never reaches JSON.
 */
import { EXIT, GameregError } from '../core/errors.ts'
import type { EventEnvelope } from '../core/events.ts'
import { serializeEvent } from '../core/events.ts'
import { localeFromEnvironment, resolveLocale, translator } from '../i18n/index.ts'
import type { Cli } from './context.ts'

export type Outcome = {
  action: string
  result: unknown
  events: readonly EventEnvelope[]
  /** Registrar prose, one line per element. Ignored under --json and --quiet. */
  prose: readonly string[]
}

export function emit(cli: Cli, outcome: Outcome): void {
  if (cli.json) {
    const payload = {
      ok: true,
      action: outcome.action,
      result: outcome.result,
      events: outcome.events.map((event) => event.id),
      ...(cli.dryRun ? { dry_run: true } : {}),
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`)
    return
  }

  if (cli.quiet) return

  const lines = [...outcome.prose]
  if (cli.dryRun) {
    lines.unshift(cli.t('prose.dry_run'))
    if (outcome.events.length > 0) {
      lines.push(cli.t('prose.dry_run_events'))
      for (const event of outcome.events) lines.push(`  ${serializeEvent(event)}`)
    }
  }
  const text = lines.filter((line) => line !== '').join('\n')
  if (text !== '') process.stdout.write(`${text}\n`)
}

/**
 * A failure can happen before a context exists (bad flags, unreadable config),
 * so the fallback resolves the locale and the output format the same way the
 * context would have.
 */
function reporter(cli: Cli | null): { t: Cli['t']; json: boolean; quiet: boolean } {
  if (cli !== null) return { t: cli.t, json: cli.json, quiet: cli.quiet }
  const bundle = translator(resolveLocale(localeFromEnvironment()))
  return { t: bundle.t, json: process.stdout.isTTY !== true, quiet: false }
}

export function emitFailure(cli: Cli | null, error: unknown): number {
  const known =
    error instanceof GameregError
      ? error
      : new GameregError('error', 'error.unexpected', {
          message: error instanceof Error ? error.message : String(error),
        })

  const output = reporter(cli)
  const message = output.t(known.key, known.params)

  if (output.json) {
    const payload = {
      ok: false,
      code: known.code,
      error: known.error,
      message,
      ...known.details,
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  } else if (!output.quiet) {
    process.stderr.write(`${message}\n`)
  }

  return known.code
}

export const OK = EXIT.ok
