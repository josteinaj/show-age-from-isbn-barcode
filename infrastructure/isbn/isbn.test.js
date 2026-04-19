import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanIsbn,
  isValidIsbn10,
  isbn10ToIsbn13,
  extractIsbnCandidatesFromText,
  normalizeScannedCode,
} from './isbn.js';

test('cleanIsbn removes non isbn characters and preserves X', () => {
  assert.equal(cleanIsbn('0-306-40615-x'), '030640615x');
});

test('isValidIsbn10 validates checksum', () => {
  assert.equal(isValidIsbn10('0306406152'), true);
  assert.equal(isValidIsbn10('0306406153'), false);
});

test('isbn10ToIsbn13 converts valid isbn10 and rejects invalid input', () => {
  assert.equal(isbn10ToIsbn13('0306406152'), '9780306406157');
  assert.equal(isbn10ToIsbn13('0306406153'), null);
});

test('extractIsbnCandidatesFromText finds unique valid candidates', () => {
  const text = `
    ISBN 978-82-02-12345-6
    Også utgave 0-306-40615-2
    Duplikat 9788202123456
    Ugyldig 0-306-40615-3
  `;

  const result = extractIsbnCandidatesFromText(text);

  assert.deepEqual(result, ['9788202123456', '0306406152', '9780306406157']);
});

test('normalizeScannedCode truncates long EAN-like values to first 13 digits', () => {
  assert.equal(normalizeScannedCode('978030640615712345'), '9780306406157');
  assert.equal(normalizeScannedCode('0306406152'), '0306406152');
});
