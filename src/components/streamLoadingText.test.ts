import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadingMessage } from './streamLoadingText.ts';

test('the loading line says more as the lookup takes longer', () => {
  assert.equal(loadingMessage(0), 'Starting…');
  assert.equal(loadingMessage(3000), 'Finding the best server…');
  assert.equal(loadingMessage(8000), 'Still looking - trying other servers…');
  assert.equal(loadingMessage(20000), 'This one is taking longer than usual…');
});
