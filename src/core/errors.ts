/**
 * One error class, carrying the exit code from docs/spec/02-cli.md.
 *
 * Messages are never built here: an error carries an i18n `key` plus params,
 * and the output layer renders it in the active locale.
 */

export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  ambiguous: 3,
  not_found: 4,
  conflict: 5,
  provider_unavailable: 6,
  needs_confirmation: 7,
} as const

export type ErrorName = keyof typeof EXIT
export type ExitCode = (typeof EXIT)[ErrorName]

export type ErrorOptions = {
  /** Extra fields spliced into the JSON failure envelope (e.g. `candidates`). */
  details?: Record<string, unknown>
  cause?: unknown
}

export class GameregError extends Error {
  readonly error: ErrorName
  readonly code: ExitCode
  readonly key: string
  readonly params: Record<string, unknown>
  readonly details: Record<string, unknown>

  constructor(
    error: ErrorName,
    key: string,
    params: Record<string, unknown> = {},
    options: ErrorOptions = {},
  ) {
    super(key, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'GameregError'
    this.error = error
    this.code = EXIT[error]
    this.key = key
    this.params = params
    this.details = options.details ?? {}
  }
}

export const usage = (key: string, params?: Record<string, unknown>): GameregError =>
  new GameregError('usage', key, params)

export const conflict = (key: string, params?: Record<string, unknown>): GameregError =>
  new GameregError('conflict', key, params)

export const notFound = (key: string, params?: Record<string, unknown>): GameregError =>
  new GameregError('not_found', key, params)

export const failure = (key: string, params?: Record<string, unknown>, cause?: unknown): GameregError =>
  new GameregError('error', key, params, { cause })
