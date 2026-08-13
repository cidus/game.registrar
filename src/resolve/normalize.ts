/**
 * Normalization (docs/spec/03-resolution.md). Applied to *both* sides of every
 * comparison, so a rule can only ever make matching more forgiving, never
 * asymmetric.
 */

const ARTICLES = new Set(['the', 'a', 'an', 'o', 'os', 'as', 'um', 'uma'])

/** Dropped for matching, preserved in the stored title. */
const EDITIONS = [
  'game of the year edition',
  'definitive edition',
  'complete edition',
  'deluxe edition',
  'special edition',
  'anniversary edition',
  'goty edition',
  'remastered',
  'remaster',
  'goty',
]

const ROMAN = /^(m{0,3})(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/
const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

function romanToArabic(token: string): string {
  if (token === '' || !ROMAN.test(token)) return token
  let total = 0
  let previous = 0
  for (const character of [...token].reverse()) {
    const value = ROMAN_VALUES[character] ?? 0
    total += value < previous ? -value : value
    previous = Math.max(previous, value)
  }
  return total === 0 ? token : String(total)
}

/**
 * `final fantasy vii` ≡ `final fantasy 7`. Only non-leading tokens are
 * converted: plenty of English words ("mix", "did") are also valid Roman
 * numerals, and a title that *starts* with one is far more likely to be a word.
 */
function numerals(tokens: readonly string[]): string[] {
  return tokens.map((token, index) => (index === 0 ? token : romanToArabic(token)))
}

export function normalize(input: string): string {
  let text = input.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

  // Dropped for matching, preserved in the stored title — same principle as
  // EDITIONS below. Must run before the punctuation strip, which would
  // otherwise turn "(2020)" into a bare "2020" indistinguishable from a
  // title that legitimately ends in a number ("Cyberpunk 2077").
  text = text.replace(/\s*\(\s*(?:19|20)\d{2}\s*\)\s*$/, '')

  text = text.replace(/&/g, ' and ')
  text = text.replace(/[^\p{L}\p{N}\s]/gu, ' ')
  text = text.replace(/\s+/g, ' ').trim()

  for (const edition of EDITIONS) {
    text = text.replace(new RegExp(`(^|\\s)${edition}(\\s|$)`, 'g'), ' ')
  }
  text = text.replace(/\s+/g, ' ').trim()

  let tokens = text.split(' ').filter((token) => token !== '')
  tokens = tokens.map((token) => (token === 'e' ? 'and' : token))
  if (tokens.length > 1 && ARTICLES.has(tokens[0] ?? '')) tokens = tokens.slice(1)
  tokens = numerals(tokens)

  return tokens.join(' ')
}

/** Filenames are slugs; slugs are mutable; identity is the ULID (01-model). */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'untitled' : slug
}

/** `hollow-knight`, `hollow-knight-2`, … — resolved against slugs already taken. */
export function uniqueSlug(title: string, taken: ReadonlySet<string>): string {
  const base = slugify(title)
  if (!taken.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}
