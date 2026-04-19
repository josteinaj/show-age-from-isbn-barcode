import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeAgeGroups } from './ageSummary.js';

test('summarizeAgeGroups returns no-age summary when no valid ranges exist', () => {
  const result = summarizeAgeGroups([null, '', 'ukjent', '5-3 år', 'ukjent']);

  assert.equal(result.hasAge, false);
  assert.equal(result.averageAge, null);
  assert.equal(result.mergedRangeLabel, '');
  assert.deepEqual(result.mergedLabels, ['ukjent', '5-3 år']);
});

test('summarizeAgeGroups merges overlapping and adjacent ranges', () => {
  const result = summarizeAgeGroups(['9-12 år', '6-8 år', '12-14 år']);

  assert.equal(result.hasAge, true);
  assert.equal(result.averageAge, 10);
  assert.equal(result.mergedRangeLabel, '6-14 år');
  assert.deepEqual(result.mergedLabels, ['6-14 år']);
});

test('summarizeAgeGroups keeps separate ranges when there is a gap', () => {
  const result = summarizeAgeGroups(['10-12 år', '6-8 år']);

  assert.equal(result.hasAge, true);
  assert.equal(result.averageAge, 9);
  assert.equal(result.mergedRangeLabel, '6-12 år');
  assert.deepEqual(result.mergedLabels, ['6-8 år', '10-12 år']);
});
