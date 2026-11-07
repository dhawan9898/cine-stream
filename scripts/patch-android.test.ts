import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain .mjs build script without type declarations
import { patchManifest, patchGradle, patchGradleProperties } from './patch-android.mjs';

const manifest = '<manifest>\n    <application>\n        <activity android:name=".MainActivity" />\n    </application>\n</manifest>';
const gradle = 'android {\n  defaultConfig {\n    versionCode 1\n    versionName "1.0"\n  }\n}\n';

test('manifest gets the player activity exactly once', () => {
  const once = patchManifest(manifest);
  assert.equal(once.match(/ExoPlayerActivity/g)?.length, 1);
  assert.equal(patchManifest(once), once);
});

test('player activity supports Picture-in-Picture', () => {
  const out = patchManifest(manifest);
  assert.match(out, /supportsPictureInPicture="true"/);
  assert.match(out, /smallestScreenSize/);
});

test('manifest gets the network-state permission once (downloads pause offline)', () => {
  const out = patchManifest(manifest);
  assert.equal(out.match(/ACCESS_NETWORK_STATE/g)?.length, 1);
  assert.equal(patchManifest(out).match(/ACCESS_NETWORK_STATE/g)?.length, 1);
});

test('manifest without </application> fails loudly', () => {
  assert.throws(() => patchManifest('<manifest/>'), /no <\/application>/);
});

test('gradle gets version and media3 once; missing fields fail loudly', () => {
  const out = patchGradle(gradle, '2.0.9', '9');
  assert.match(out, /versionCode 9/);
  assert.match(out, /versionName "2\.0\.9"/);
  assert.equal(out.match(/media3-exoplayer:/g)?.length, 1);
  assert.equal(patchGradle(out, '2.0.9', '9'), out);
  assert.throws(() => patchGradle('android {}', '1', '1'), /versionCode not found/);
});

test('gradle.properties tuning is appended once', () => {
  const once = patchGradleProperties('android.useAndroidX=true\n');
  assert.equal(patchGradleProperties(once), once);
  assert.match(once, /org\.gradle\.caching=true/);
});
