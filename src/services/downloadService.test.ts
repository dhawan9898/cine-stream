import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadId, formatBytes, findCompletedDownload, completedEpisodes, downloadsSupported } from './downloadService.ts';

test('download ids are stable per title / season / episode', () => {
  assert.equal(downloadId('movie', 603), 'movie|603|0|0');
  assert.equal(downloadId('tv', 1399, 2, 5), 'tv|1399|2|5');
  assert.notEqual(downloadId('tv', 1399, 2, 5), downloadId('tv', 1399, 5, 2));
});

test('formatBytes picks a readable unit', () => {
  assert.equal(formatBytes(512), '1 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(formatBytes(1.5 * 1024 ** 3), '1.5 GB');
});

test('with nothing downloaded there is nothing to play offline', () => {
  assert.equal(findCompletedDownload('movie', 1), undefined);
  assert.deepEqual(completedEpisodes(1), []);
  assert.equal(downloadsSupported(), false); // not running in the native app
});
