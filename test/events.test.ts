import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { appendEvents, makeEvent, readEvents, readLog, serializeEvent } from '../src/core/events.ts'
import { isUlid, newId } from '../src/core/ids.ts'
import { event, tempDir } from './helpers.ts'

test('makeEvent produces a ULID and the current schema version', () => {
  const created = makeEvent('session.open', { session_id: 'x' })
  assert.ok(isUlid(created.id))
  assert.equal(created.schema, 1)
  assert.equal(created.source, 'cli')
})

test('ULIDs from the same millisecond stay ordered', () => {
  const ids = Array.from({ length: 50 }, () => newId())
  assert.deepEqual(ids, [...ids].sort())
})

test('serialization keeps a fixed key order', () => {
  const line = serializeEvent(event('session.open', { session_id: 'S1' }))
  assert.match(line, /^\{"id":".*","ts":".*","type":"session\.open","source":"cli","schema":1,"data":/)
})

test('append writes one LF-terminated line per event and reads back identically', () => {
  const file = join(tempDir(), 'data', 'events.jsonl')
  const events = [event('game.create', { game_id: 'G1', slug: 'a', title: 'A' }), event('session.open', { session_id: 'S1' })]

  appendEvents(file, [events[0]!])
  appendEvents(file, [events[1]!])

  const raw = readFileSync(file, 'utf8')
  assert.equal(raw.split('\n').length, 3)
  assert.ok(raw.endsWith('\n'))
  assert.ok(!raw.includes('\r'))
  assert.deepEqual(readEvents(file), events)
})

test('append repairs a log whose last line lost its newline', () => {
  const dir = tempDir()
  const file = join(dir, 'events.jsonl')
  writeFileSync(file, serializeEvent(event('game.create', { game_id: 'G1', slug: 'a', title: 'A' })))

  appendEvents(file, [event('session.open', { session_id: 'S1' })])

  assert.equal(readEvents(file).length, 2)
})

test('append never rewrites existing bytes', () => {
  const file = join(tempDir(), 'events.jsonl')
  appendEvents(file, [event('game.create', { game_id: 'G1', slug: 'a', title: 'A' })])
  const before = readFileSync(file, 'utf8')

  appendEvents(file, [event('session.open', { session_id: 'S1' })])

  assert.ok(readFileSync(file, 'utf8').startsWith(before))
})

test('a malformed line is reported, not thrown, and does not stop the read', () => {
  const file = join(tempDir(), 'events.jsonl')
  appendEvents(file, [event('game.create', { game_id: 'G1', slug: 'a', title: 'A' })])
  writeFileSync(file, `{ this is not json\n${readFileSync(file, 'utf8')}`)

  const result = readLog(file)
  assert.equal(result.events.length, 1)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0]?.line, 1)
  assert.throws(() => readEvents(file), /error\.corrupt_log/)
})

test('an unknown event type is a problem, not a crash', () => {
  const file = join(tempDir(), 'events.jsonl')
  writeFileSync(file, '{"id":"A","ts":"2026-01-01T00:00:00Z","type":"game.explode","source":"cli","schema":1,"data":{}}\n')

  const result = readLog(file)
  assert.equal(result.events.length, 0)
  assert.equal(result.problems[0]?.key, 'doctor.unknown_event_type')
})

test('reading a log that does not exist yields nothing', () => {
  assert.deepEqual(readLog(join(tempDir(), 'nope.jsonl')), { events: [], problems: [] })
})
