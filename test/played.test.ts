/**
 * The duration clauses the game note, the run note and the diary share
 * (`src/render/played.ts`).
 *
 * It was three copies of one conditional until the third inherited the
 * second's bug, so what is pinned here is the rule rather than any one
 * renderer's wording: how long, where the time came from, and no claim the log
 * does not support. 01-model.md states it as "reports must never treat a
 * stated portion as if it were measured".
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { translator } from '../src/i18n/index.ts'
import { timePlayed } from '../src/render/played.ts'

const EN = translator('en')
const PT = translator('pt-BR')

test('measured time is stated with the sessions it came from', () => {
  assert.deepEqual(timePlayed(150, 1, 0, EN), ['2h30 in one session'])
  assert.deepEqual(timePlayed(538, 3, 0, EN), ['8h58 across 3 sessions'])
})

test('stated hours are marked, and claim no sessions', () => {
  // `import` and `past --hours` file hours against the run and against no
  // sitting at all. "30h00 across 0 sessions" said two false things: that a
  // count of zero was recorded, and that these hours came from sessions.
  assert.deepEqual(timePlayed(1800, 0, 1800, EN), ['30h00 (stated)'])
})

test('a mixed run keeps the two numbers apart, each with its own provenance', () => {
  // 20h00 predate the register; three sessions measured 8h58 after it. The
  // total is 28h58 and is deliberately absent: it sums two kinds of number,
  // and it is already carried by frontmatter and the consolidated table.
  const parts = timePlayed(1200 + 538, 3, 1200, EN)
  assert.deepEqual(parts, ['20h00 (stated)', '8h58 across 3 sessions'])
  // The measured clause counts only the measured minutes — never the total,
  // which is the bug this case exists for.
  assert.equal(parts.some((part) => part.includes('28h58')), false)
})

test('nothing on record says nothing at all, so the caller omits the part', () => {
  // Never "0m": an open session is not estimated, and a zero would read as a
  // claim that no time passed. An empty array rather than '' so a `·`-joined
  // header does not end up with a dangling separator.
  assert.deepEqual(timePlayed(0, 0, 0, EN), [])
  assert.deepEqual(timePlayed(0, 2, 0, EN), [])
})

test('both clauses are localized, and reuse the table\'s own stated marker', () => {
  assert.deepEqual(timePlayed(150, 1, 0, PT), ['2h30 em uma sessão'])
  assert.deepEqual(timePlayed(1200 + 538, 3, 1200, PT), ['20h00 (declarada)', '8h58 em 3 sessões'])

  // The marker is the consolidated table's key, not a second spelling of the
  // same idea — and a parenthetical does not inflect, which "{duration}
  // declaradas" would the first time a baseline is filed in minutes.
  assert.equal(timePlayed(30, 0, 30, PT)[0], `30m (${PT.t('table.stated_marker')})`)
})
