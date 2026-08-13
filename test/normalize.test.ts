import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalize, slugify, uniqueSlug } from '../src/resolve/normalize.ts'

test('combining marks are stripped and case is folded', () => {
  assert.equal(normalize('Pokémon'), 'pokemon')
  assert.equal(normalize('POKEMON'), 'pokemon')
})

test('punctuation goes and whitespace collapses', () => {
  assert.equal(normalize('  The Legend of Zelda:  Breath of the Wild! '), 'legend of zelda breath of the wild')
})

test('a leading article is dropped on both sides of the comparison', () => {
  assert.equal(normalize('The Last of Us'), normalize('Last of Us'))
  assert.equal(normalize('O Mundo'), normalize('Mundo'))
  assert.equal(normalize('A'), 'a')
})

test('a trailing parenthesized release year is dropped for matching', () => {
  assert.equal(normalize('Final Fantasy VII Remake (2020)'), normalize('Final Fantasy VII Remake'))
  assert.equal(normalize('XCOM (2012)'), 'xcom')
  assert.equal(normalize('XCOM ( 2012 )'), 'xcom')
})

test('a bare trailing number with no parentheses is part of the title, not a year suffix', () => {
  assert.equal(normalize('Cyberpunk 2077'), 'cyberpunk 2077')
  assert.equal(normalize('Battlefield 2042'), 'battlefield 2042')
})

test('edition suffixes are dropped for matching', () => {
  assert.equal(normalize('Skyrim Special Edition'), 'skyrim')
  assert.equal(normalize('Dark Souls Remastered'), 'dark souls')
  assert.equal(normalize('Sleeping Dogs Definitive Edition'), 'sleeping dogs')
  assert.equal(normalize('Borderlands GOTY'), 'borderlands')
})

test('{ editions: false } keeps edition suffixes literal, for provider matching', () => {
  assert.equal(normalize('Skyrim Special Edition', { editions: false }), 'skyrim special edition')
  assert.notEqual(
    normalize('Final Fantasy VII Remake', { editions: false }),
    normalize('Final Fantasy VII Remake: Deluxe Edition', { editions: false }),
  )
  // Everything else still applies with editions off: diacritics, case, roman numerals, the trailing-year rule.
  assert.equal(normalize('Pokémon (1998)', { editions: false }), 'pokemon')
})

test('roman and arabic numerals are equivalent', () => {
  assert.equal(normalize('Final Fantasy VII'), normalize('Final Fantasy 7'))
  assert.equal(normalize('Grand Theft Auto V'), normalize('Grand Theft Auto 5'))
  assert.equal(normalize('Persona 5'), 'persona 5')
})

test('a leading word that happens to be a roman numeral stays a word', () => {
  assert.equal(normalize('Mix Master'), 'mix master')
  assert.equal(normalize('Did You Know'), 'did you know')
})

test('& and and e are the same conjunction', () => {
  assert.equal(normalize('Ratchet & Clank'), normalize('Ratchet and Clank'))
  assert.equal(normalize('Ratchet & Clank'), normalize('Ratchet e Clank'))
})

test('slugs are filenames, and collisions get a suffix', () => {
  assert.equal(slugify('The Legend of Zelda: Breath of the Wild'), 'the-legend-of-zelda-breath-of-the-wild')
  assert.equal(slugify('Pokémon Red'), 'pokemon-red')
  assert.equal(slugify('???'), 'untitled')
  assert.equal(uniqueSlug('Celeste', new Set()), 'celeste')
  assert.equal(uniqueSlug('Celeste', new Set(['celeste'])), 'celeste-2')
  assert.equal(uniqueSlug('Celeste', new Set(['celeste', 'celeste-2'])), 'celeste-3')
})
