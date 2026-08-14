/**
 * Provider credentials (docs/spec/02-cli.md "Provider credentials").
 *
 * Two sources, environment first: `IGDB_CLIENT_ID` beats
 * `gamereg.secrets.json`'s `igdb.client_id`. Neither is required — a provider
 * with no credential from either source is simply unavailable, and `enrich`
 * reports exactly which field is missing.
 *
 * This file only reads. `gamereg.secrets.json` is written once, by `init`,
 * and never touched by any other command — no command persists a credential
 * it was handed on the command line.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { GameregError } from './errors.ts'

export const SECRETS_FILENAME = 'gamereg.secrets.json'

/** Every known provider and the credential fields it needs, in the shape `init` seeds. */
export const PROVIDER_CREDENTIAL_FIELDS = {
  igdb: ['client_id', 'client_secret'],
} as const

export type ProviderName = keyof typeof PROVIDER_CREDENTIAL_FIELDS

export const PROVIDER_NAMES = Object.keys(PROVIDER_CREDENTIAL_FIELDS) as ProviderName[]

export type Secrets = Record<string, Record<string, string>>

export function emptySecrets(): Secrets {
  const secrets: Secrets = {}
  for (const provider of PROVIDER_NAMES) {
    secrets[provider] = {}
    for (const field of PROVIDER_CREDENTIAL_FIELDS[provider]) secrets[provider]![field] = ''
  }
  return secrets
}

export function loadSecrets(root: string): Secrets {
  const file = join(root, SECRETS_FILENAME)
  if (!existsSync(file)) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (cause) {
    throw new GameregError('usage', 'error.bad_config', { file }, { cause })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GameregError('usage', 'error.bad_config', { file })
  }

  const secrets: Secrets = {}
  for (const [provider, fields] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) continue
    const entry: Record<string, string> = {}
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (typeof value === 'string') entry[field] = value
    }
    secrets[provider] = entry
  }
  return secrets
}

function envVarName(provider: string, field: string): string {
  return `${provider}_${field}`.toUpperCase()
}

/** Environment variable first, then `gamereg.secrets.json`. Blank counts as absent. */
export function resolveCredential(root: string, provider: string, field: string, secrets?: Secrets): string | null {
  const fromEnv = process.env[envVarName(provider, field)]
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv

  const loaded = secrets ?? loadSecrets(root)
  const fromFile = loaded[provider]?.[field]
  return fromFile !== undefined && fromFile !== '' ? fromFile : null
}

export type CredentialResult<T extends string> =
  | { ok: true; values: Record<T, string> }
  | { ok: false; missing: string }

/**
 * Resolves every field a provider needs. `missing` names the field so
 * `enrich`'s exit-6 message can say exactly which credential is absent,
 * rather than making the caller guess.
 */
export function resolveProviderCredentials<T extends string>(
  root: string,
  provider: string,
  fields: readonly T[],
): CredentialResult<T> {
  const secrets = loadSecrets(root)
  const values = {} as Record<T, string>
  for (const field of fields) {
    const value = resolveCredential(root, provider, field, secrets)
    if (value === null) return { ok: false, missing: envVarName(provider, field) }
    values[field] = value
  }
  return { ok: true, values }
}
