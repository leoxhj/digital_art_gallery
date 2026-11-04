const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeArtworkMetadata } = require('../artwork_metadata');

test('normalizes valid artwork metadata', () => {
  assert.deepEqual(normalizeArtworkMetadata({
    title: '  A New World  ',
    age: '9',
    medium: '  Watercolor ',
    category: ' Space ',
    description: '  A picture of a planet.  ',
  }), {
    title: 'A New World',
    age: 9,
    medium: 'Watercolor',
    category: 'Space',
    categories: ['Space'],
    description: 'A picture of a planet.',
  });
});

test('normalizes and deduplicates multiple sections', () => {
  assert.deepEqual(normalizeArtworkMetadata({
    title: 'A New World',
    age: '9',
    medium: 'Watercolor',
    category: 'Space | Portraits | Space',
  }).categories, ['Space', 'Portraits']);
});

test('preserves commas inside a section name', () => {
  assert.deepEqual(normalizeArtworkMetadata({
    title: 'A New World',
    age: '9',
    medium: 'Watercolor',
    category: '其它,5岁',
  }).categories, ['其它,5岁']);
});

test('allows an empty optional description', () => {
  const metadata = normalizeArtworkMetadata({
    title: 'Untitled',
    age: '0',
    medium: 'Pencil',
    category: 'Portraits',
    description: '  ',
  });

  assert.equal(metadata.description, null);
});

test('rejects missing required metadata', () => {
  assert.equal(normalizeArtworkMetadata({ title: 'Work', age: '9', medium: 'Ink' }), null);
});

test('rejects non-integer and out-of-range ages', () => {
  const metadata = { title: 'Work', medium: 'Ink', category: 'Portraits' };
  for (const age of ['', '9.5', '-1', '121', 'not an age']) {
    assert.equal(normalizeArtworkMetadata({ ...metadata, age }), null);
  }
});

test('calculates age on the artwork date using a configurable birthday', async () => {
  const { calculateAgeAtDate } = await import('../src/age_calculation.mjs');

  assert.equal(calculateAgeAtDate('2026-09-03', '2017-09-04'), 8);
  assert.equal(calculateAgeAtDate('2026-09-04', '2017-09-04'), 9);
  assert.equal(calculateAgeAtDate('2023-08-08', '2017-09-04'), 5);
  assert.equal(calculateAgeAtDate('2017-09-03', '2017-09-04'), null);
  assert.equal(calculateAgeAtDate('2024-02-30', '2017-09-04'), null);
});