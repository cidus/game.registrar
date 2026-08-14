/**
 * Which providers exist, and how `--provider` narrows them.
 *
 * Two commands reach the network — `enrich` (docs/spec/02-cli.md) and
 * `search`, for resolution step 6 (03-resolution.md) — and both accept the
 * same `--provider <name>`. Keeping the list here rather than in either
 * command is what makes them agree: a second provider (00-architecture.md
 * D5 makes them pluggable; 06-roadmap.md names BoardGameGeek as a
 * candidate) joins in exactly two places, this file and
 * `PROVIDER_CREDENTIAL_FIELDS` in core/secrets.ts.
 *
 * Order is the chain order: with no `--provider`, every known provider is
 * tried in the order listed here.
 */
import { GameregError } from '../core/errors.ts'
import { createIgdbProvider } from './igdb.ts'
import type { Provider } from './provider.ts'

export const KNOWN_PROVIDERS = ['igdb'] as const

export function isKnownProvider(name: string): boolean {
  return (KNOWN_PROVIDERS as readonly string[]).includes(name)
}

/** The usage error a bad `--provider`, or a bad `--match <provider>:<id>`, raises. */
export function unknownProvider(name: string): GameregError {
  return new GameregError('usage', 'error.enum', {
    field: 'provider',
    value: name,
    valid: KNOWN_PROVIDERS.join(', '),
  })
}

export function createProvider(name: string, root: string): Provider {
  if (name === 'igdb') return createIgdbProvider(root)
  throw unknownProvider(name)
}

/** No `--provider`: try every known provider in order. */
export function providerChain(root: string, requested: string | undefined): Provider[] {
  if (requested !== undefined) return [createProvider(requested, root)]
  return KNOWN_PROVIDERS.map((name) => createProvider(name, root))
}
