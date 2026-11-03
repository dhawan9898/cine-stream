// patch-android.mjs - Applies CineStream's native customisations to the
// Capacitor-generated android/ project (which is not committed).
//
// This replaces a block of inline `sed`/`echo` in the CI workflow. Every step
// verifies that it actually changed something and fails loudly otherwise, so a
// Capacitor template change breaks the build instead of silently shipping an
// APK without the native player.
//
// Usage: node scripts/patch-android.mjs --version 2.0.17 --version-code 17
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MEDIA3 = '1.5.1';
const PACKAGE_DIR = 'com/cinehype/stream';

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

export function patchManifest(xml) {
  if (xml.includes('android:name=".ExoPlayerActivity"')) return xml; // already patched
  const activity =
    '        <activity android:name=".ExoPlayerActivity"' +
    ' android:configChanges="orientation|screenSize|screenLayout|keyboardHidden"' +
    ' android:launchMode="singleTask"' +
    ' android:screenOrientation="sensorLandscape"' +
    ' android:theme="@style/Theme.CineStream.Player"' +
    ' android:exported="false" />\n';
  if (!xml.includes('</application>')) throw new Error('AndroidManifest.xml has no </application> tag');
  return xml.replace('</application>', activity + '    </application>');
}

export function patchGradle(gradle, version, versionCode) {
  let out = gradle;
  const codeRe = /versionCode\s+\d+/;
  const nameRe = /versionName\s+"[^"]*"/;
  if (!codeRe.test(out)) throw new Error('versionCode not found in app/build.gradle');
  if (!nameRe.test(out)) throw new Error('versionName not found in app/build.gradle');
  out = out.replace(codeRe, `versionCode ${versionCode}`).replace(nameRe, `versionName "${version}"`);

  if (!out.includes('media3-exoplayer:')) {
    const deps = ['exoplayer', 'ui', 'exoplayer-hls', 'datasource', 'common', 'exoplayer-dash']
      .map(m => `    implementation "androidx.media3:media3-${m}:${MEDIA3}"`)
      .join('\n');
    out += `\n// CineStream native player\ndependencies {\n${deps}\n}\n`;
  }
  return out;
}

// Faster, cache-friendly Gradle builds. Appended once.
export function patchGradleProperties(props) {
  if (props.includes('# CineStream build tuning')) return props;
  return `${props.replace(/\s*$/, '\n')}
# CineStream build tuning
org.gradle.jvmargs=-Xmx3g -XX:+UseParallelGC
org.gradle.parallel=true
org.gradle.caching=true
`;
}

function main() {
  const { version, 'version-code': versionCode, root = 'android' } = parseArgs(process.argv.slice(2));
  if (!version || !versionCode) throw new Error('Usage: patch-android.mjs --version X.Y.Z --version-code N');

  const javaDir = join(root, 'app/src/main/java', PACKAGE_DIR);
  if (!existsSync(javaDir)) throw new Error(`Generated Java package dir not found: ${javaDir}`);

  const overrideJava = readdirSync('android-overrides/java').filter(f => f.endsWith('.java'));
  if (!overrideJava.length) throw new Error('No Java overrides found in android-overrides/java');
  for (const f of overrideJava) cpSync(join('android-overrides/java', f), join(javaDir, f));
  cpSync('android-overrides/res', join(root, 'app/src/main/res'), { recursive: true });

  const manifestPath = join(root, 'app/src/main/AndroidManifest.xml');
  writeFileSync(manifestPath, patchManifest(readFileSync(manifestPath, 'utf8')));

  const gradlePath = join(root, 'app/build.gradle');
  writeFileSync(gradlePath, patchGradle(readFileSync(gradlePath, 'utf8'), version, versionCode));

  const propsPath = join(root, 'gradle.properties');
  writeFileSync(propsPath, patchGradleProperties(existsSync(propsPath) ? readFileSync(propsPath, 'utf8') : ''));

  console.log(`Patched Android project: version ${version} (code ${versionCode}), ${overrideJava.length} Java overrides.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) main();
