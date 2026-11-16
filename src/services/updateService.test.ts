import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver } from './updateService.ts';

test('compareSemver handles basic version numbers', () => {
  assert.equal(compareSemver('2.0.2', '2.0.1'), 1);
  assert.equal(compareSemver('2.0.1', '2.0.2'), -1);
  assert.equal(compareSemver('2.0.1', '2.0.1'), 0);
});

test('compareSemver handles v prefix', () => {
  assert.equal(compareSemver('v2.1.0', '2.0.9'), 1);
  assert.equal(compareSemver('v10.15', '10.1.0'), 1);
  assert.equal(compareSemver('v10.1', '10.10.0'), -1);
});

test('compareSemver handles different length version parts', () => {
  assert.equal(compareSemver('2.0.1.1', '2.0.1'), 1);
  assert.equal(compareSemver('2.1', '2.1.0'), 0);
  assert.equal(compareSemver('3', '2.9.9'), 1);
});
