import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DateTime } from 'luxon'

import { formatHm, formatHours, minutesBetween, parseDuration } from '../src/core/duration.ts'
import { logicalDay, parseAt, parseImpreciseDate, parseISO, toISO } from '../src/core/time.ts'
import { ZONE, context } from './helpers.ts'

test('durations parse in every documented spelling', () => {
  assert.equal(parseDuration('90'), 90)
  assert.equal(parseDuration('40m'), 40)
  assert.equal(parseDuration('2h'), 120)
  assert.equal(parseDuration('1h20'), 80)
  assert.equal(parseDuration('1h20m'), 80)
  assert.equal(parseDuration('1:20'), 80)
  assert.equal(parseDuration(' 40M '), 40)
})

test('a nonsense duration is a usage error', () => {
  assert.throws(() => parseDuration('later'), /error\.bad_duration/)
  assert.throws(() => parseDuration('1h90'), /error\.bad_duration/)
  assert.throws(() => parseDuration('-40m'), /error\.bad_duration/)
})

test('durations format as hours and padded minutes', () => {
  assert.equal(formatHm(178), '2h58')
  assert.equal(formatHm(65), '1h05')
  assert.equal(formatHm(58), '58m')
  assert.equal(formatHm(0), '0m')
  assert.equal(formatHm(120), '2h00')
})

test('hours carry exactly one decimal place', () => {
  assert.equal(formatHours(2538), '42.3')
  assert.equal(formatHours(60), '1.0')
  assert.equal(formatHours(0), '0.0')
})

test('minutes between instants ignore the offsets they were written in', () => {
  const from = parseISO('2026-05-03T20:00:00-03:00', context)
  const to = parseISO('2026-05-03T23:58:00-03:00', context)
  assert.equal(minutesBetween(from, to), 238)
})

test('a session after midnight belongs to the day it started', () => {
  const cutoff = '05:00'
  assert.equal(logicalDay(parseISO('2026-05-03T22:00:00-03:00', context), cutoff), '2026-05-03')
  assert.equal(logicalDay(parseISO('2026-05-04T02:30:00-03:00', context), cutoff), '2026-05-03')
  assert.equal(logicalDay(parseISO('2026-05-04T05:00:00-03:00', context), cutoff), '2026-05-04')
})

test('--at reads ISO, date-and-time, clock and relative forms', () => {
  const now = DateTime.fromISO('2026-05-03T23:00:00', { zone: ZONE })
  const at = { ...context, now }

  assert.equal(toISO(parseAt('2026-05-03T20:14:00-03:00', at)), '2026-05-03T20:14:00-03:00')
  assert.equal(toISO(parseAt('2026-05-03 20:14', at)), '2026-05-03T20:14:00-03:00')
  assert.equal(toISO(parseAt('20:14', at)), '2026-05-03T20:14:00-03:00')
  assert.equal(toISO(parseAt('-90m', at)), '2026-05-03T21:30:00-03:00')
  assert.equal(toISO(parseAt('-2h', at)), '2026-05-03T21:00:00-03:00')
})

test('a clock time that would land in the future means yesterday', () => {
  const now = DateTime.fromISO('2026-05-04T03:00:00', { zone: ZONE })
  const at = { ...context, now }
  assert.equal(toISO(parseAt('22:00', at)), '2026-05-03T22:00:00-03:00')
  assert.equal(toISO(parseAt('02:00', at)), '2026-05-04T02:00:00-03:00')
})

test('an unreadable time is a usage error', () => {
  assert.throws(() => parseAt('yesterday evening', context), /error\.bad_time/)
})

test('date precision comes from the shape of the argument', () => {
  assert.deepEqual(parseImpreciseDate('2011'), { date: '2011-01-01', precision: 'year', text: '2011' })
  assert.deepEqual(parseImpreciseDate('2011-07'), { date: '2011-07-01', precision: 'month', text: '2011-07' })
  assert.deepEqual(parseImpreciseDate('2011-07-14'), { date: '2011-07-14', precision: 'day', text: '2011-07-14' })
  assert.throws(() => parseImpreciseDate('July 2011'), /error\.bad_date/)
})
