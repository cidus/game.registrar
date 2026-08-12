import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findRegions, spliceBlocks, wrapBlock } from '../src/render/markers.ts'

const FILE = 'note.md'

test('a block is replaced and everything around it is byte-identical', () => {
  const source = [
    'Prose above.',
    '',
    '<!-- gamereg:begin block=sessions -->',
    'old content',
    '<!-- gamereg:end block=sessions -->',
    '',
    'Prose below.',
    '',
  ].join('\n')

  const output = spliceBlocks(source, [{ block: 'sessions', content: 'new content' }], FILE)

  assert.equal(
    output,
    [
      'Prose above.',
      '',
      '<!-- gamereg:begin block=sessions -->',
      'new content',
      '<!-- gamereg:end block=sessions -->',
      '',
      'Prose below.',
      '',
    ].join('\n'),
  )
})

test('several blocks in one file are spliced independently', () => {
  const source = [
    '<!-- gamereg:begin block=header -->',
    'h',
    '<!-- gamereg:end block=header -->',
    '',
    'between',
    '',
    '<!-- gamereg:begin block=sessions -->',
    's',
    '<!-- gamereg:end block=sessions -->',
    '',
  ].join('\n')

  const output = spliceBlocks(
    source,
    [
      { block: 'header', content: 'H2' },
      { block: 'sessions', content: 'S2' },
    ],
    FILE,
  )

  assert.match(output, /block=header -->\nH2\n<!-- gamereg:end/)
  assert.match(output, /block=sessions -->\nS2\n<!-- gamereg:end/)
  assert.match(output, /\nbetween\n/)
})

test('a missing block is appended at the end, under its heading', () => {
  const source = 'Just prose.\n'
  const output = spliceBlocks(source, [{ block: 'sessions', content: 'table', heading: 'Log' }], FILE)

  assert.ok(output.startsWith('Just prose.\n'))
  assert.ok(output.includes('## Log\n\n<!-- gamereg:begin block=sessions -->\ntable\n<!-- gamereg:end block=sessions -->'))
})

test('a marker inside a fenced code block is text, not a marker', () => {
  const source = ['```markdown', '<!-- gamereg:begin block=sessions -->', '```', ''].join('\n')
  assert.deepEqual(findRegions(source, FILE), [])
})

test('an unpaired marker is a hard error', () => {
  assert.throws(
    () => findRegions('<!-- gamereg:begin block=sessions -->\ncontent\n', FILE),
    /error\.marker_unpaired/,
  )
  assert.throws(() => findRegions('<!-- gamereg:end block=sessions -->\n', FILE), /error\.marker_unopened/)
})

test('a nested marker is a hard error, never a guess', () => {
  const source = [
    '<!-- gamereg:begin block=header -->',
    '',
    '<!-- gamereg:begin block=sessions -->',
    '',
    '<!-- gamereg:end block=sessions -->',
    '',
    '<!-- gamereg:end block=header -->',
    '',
  ].join('\n')
  assert.throws(() => findRegions(source, FILE), /error\.marker_nested/)
})

test('an empty block keeps its markers adjacent', () => {
  assert.equal(
    wrapBlock('gallery', '   '),
    '<!-- gamereg:begin block=gallery -->\n<!-- gamereg:end block=gallery -->',
  )
})

test('a block whose content contains a blank line still closes correctly', () => {
  const source = [
    '<!-- gamereg:begin block=sessions -->',
    'one',
    '',
    'two',
    '<!-- gamereg:end block=sessions -->',
    '',
  ].join('\n')
  const output = spliceBlocks(source, [{ block: 'sessions', content: 'only' }], FILE)
  assert.equal(output, '<!-- gamereg:begin block=sessions -->\nonly\n<!-- gamereg:end block=sessions -->\n')
})
