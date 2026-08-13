import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseCsv } from '../src/cli/csv-parse.ts'

test('a simple header and rows', () => {
  const rows = parseCsv('Title,Ended\nHollow Knight,2026-08-12\nCeleste,2026-07-20\n')
  assert.deepEqual(rows, [
    { Title: 'Hollow Knight', Ended: '2026-08-12' },
    { Title: 'Celeste', Ended: '2026-07-20' },
  ])
})

test('quoted fields with embedded commas and quotes', () => {
  const rows = parseCsv('Title,Note\n"Chrono, Trigger","Said ""wow"" a lot"\n')
  assert.deepEqual(rows, [{ Title: 'Chrono, Trigger', Note: 'Said "wow" a lot' }])
})

test('a quoted field with an embedded newline', () => {
  const rows = parseCsv('Title,Note\n"Outer\nWilds",fine\n')
  assert.deepEqual(rows, [{ Title: 'Outer\nWilds', Note: 'fine' }])
})

test('CRLF line endings are accepted', () => {
  const rows = parseCsv('Title,Ended\r\nCeleste,2026-07-20\r\n')
  assert.deepEqual(rows, [{ Title: 'Celeste', Ended: '2026-07-20' }])
})

test('no trailing newline on the last row is fine', () => {
  const rows = parseCsv('Title,Ended\nCeleste,2026-07-20')
  assert.deepEqual(rows, [{ Title: 'Celeste', Ended: '2026-07-20' }])
})

test('a header with no data rows returns an empty array', () => {
  assert.deepEqual(parseCsv('Title,Ended\n'), [])
  assert.deepEqual(parseCsv(''), [])
})

test('a short row leaves missing columns as empty strings', () => {
  const rows = parseCsv('Title,Ended,Hours\nCeleste,2026-07-20\n')
  assert.deepEqual(rows, [{ Title: 'Celeste', Ended: '2026-07-20', Hours: '' }])
})
