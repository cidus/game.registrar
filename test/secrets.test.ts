/**
 * Provider credential resolution (docs/spec/02-cli.md "Provider credentials").
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadSecrets, resolveCredential, resolveProviderCredentials, SECRETS_FILENAME } from '../src/core/secrets.ts'
import { tempDir } from './helpers.ts'

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) previous[key] = process.env[key]
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('loadSecrets returns empty when the file does not exist', () => {
  assert.deepEqual(loadSecrets(tempDir()), {})
})

test('loadSecrets reads the vault-root file', () => {
  const root = tempDir()
  writeFileSync(join(root, SECRETS_FILENAME), JSON.stringify({ igdb: { client_id: 'abc' } }))
  assert.deepEqual(loadSecrets(root), { igdb: { client_id: 'abc' } })
})

test('an environment variable wins over the secrets file', () => {
  const root = tempDir()
  writeFileSync(join(root, SECRETS_FILENAME), JSON.stringify({ igdb: { client_id: 'from-file' } }))
  withEnv({ IGDB_CLIENT_ID: 'from-env' }, () => {
    assert.equal(resolveCredential(root, 'igdb', 'client_id'), 'from-env')
  })
})

test('falls back to the secrets file when no environment variable is set', () => {
  const root = tempDir()
  writeFileSync(join(root, SECRETS_FILENAME), JSON.stringify({ igdb: { client_id: 'from-file' } }))
  withEnv({ IGDB_CLIENT_ID: undefined }, () => {
    assert.equal(resolveCredential(root, 'igdb', 'client_id'), 'from-file')
  })
})

test('a blank value counts as absent, in either source', () => {
  const root = tempDir()
  writeFileSync(join(root, SECRETS_FILENAME), JSON.stringify({ igdb: { client_id: '' } }))
  withEnv({ IGDB_CLIENT_ID: '' }, () => {
    assert.equal(resolveCredential(root, 'igdb', 'client_id'), null)
  })
})

test('neither source present resolves to null', () => {
  withEnv({ IGDB_CLIENT_ID: undefined }, () => {
    assert.equal(resolveCredential(tempDir(), 'igdb', 'client_id'), null)
  })
})

test('resolveProviderCredentials returns every field when all are present', () => {
  const root = tempDir()
  withEnv({ IGDB_CLIENT_ID: 'id', IGDB_CLIENT_SECRET: 'secret' }, () => {
    const result = resolveProviderCredentials(root, 'igdb', ['client_id', 'client_secret'] as const)
    assert.deepEqual(result, { ok: true, values: { client_id: 'id', client_secret: 'secret' } })
  })
})

test('resolveProviderCredentials names the missing field, as an env var, when one is absent', () => {
  const root = tempDir()
  withEnv({ IGDB_CLIENT_ID: 'id', IGDB_CLIENT_SECRET: undefined }, () => {
    const result = resolveProviderCredentials(root, 'igdb', ['client_id', 'client_secret'] as const)
    assert.deepEqual(result, { ok: false, missing: 'IGDB_CLIENT_SECRET' })
  })
})

test('a malformed secrets file is a bad_config error', () => {
  const root = tempDir()
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, SECRETS_FILENAME), '{ not json')
  assert.throws(() => loadSecrets(root), /error\.bad_config/)
})
