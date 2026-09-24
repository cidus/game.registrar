/**
 * The duration clause the game note, the run note and the diary share
 * (`src/render/played.ts`).
 *
 * It was three copies of one conditional until the third inherited the second's
 * bug, so what is pinned here is the rule rather than any one renderer's
 * wording: how long, and over how many sittings — and no claim about sittings
 * when there were none to count.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { translator } from '../src/i18n/index.ts'
import { timePlayed } from '../src/render/played.ts'

const EN = translator('en')

test('measured time is stated with the sessions it came from', () => {
  assert.equal(timePlayed(150, 1, EN), '2h30 in one session')
  assert.equal(timePlayed(538, 3, EN), '8h58 across 3 sessions')
})

test('stated hours with no sessions are the duration alone', () => {
  // `import` and `past --hours` file hours against the run and against no
  // sitting at all. "30h00 across 0 sessions" said two false things: that a
  // count of zero was recorded, and that these hours came from sessions.
  assert.equal(timePlayed(1800, 0, EN), '30h00')
  assert.equal(String(timePlayed(1800, 0, EN)).includes('0 sessions'), false)
})

test('nothing measured says nothing at all, so the caller can omit the part', () => {
  // Never "0m": an open session is not estimated, and a zero would read as a
  // claim that no time passed. `null` rather than '' so a `·`-joined header
  // does not end up with a dangling separator.
  assert.equal(timePlayed(0, 0, EN), null)
  assert.equal(timePlayed(0, 2, EN), null)
})

test('the clause is localized, and the bare duration needs no locale', () => {
  const pt = translator('pt-BR')
  assert.equal(timePlayed(150, 1, pt), '2h30 em uma sessão')
  assert.equal(timePlayed(538, 3, pt), '8h58 em 3 sessões')
  // A duration is data, formatted the same in every locale — the same reason
  // the session table writes it into a cell with no `t()` around it.
  assert.equal(timePlayed(1800, 0, pt), timePlayed(1800, 0, EN))
})
