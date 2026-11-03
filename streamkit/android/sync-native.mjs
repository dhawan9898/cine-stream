// Copies the native files shared by the apps (drawables, ThumbnailSprites) into a generated
// Android project, stamping the app package into the Java template.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function put(dest, content, check, changed) {
  const same = existsSync(dest) && readFileSync(dest).equals(content);
  if (same) return;
  changed.push(dest);
  if (!check) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
}

/** Returns the destination files that were written (or, with `check`, that differ). */
export function syncNative({ packageName, javaDir, resDir, check = false }) {
  const changed = [];
  const tpl = readFileSync(join(here, 'ThumbnailSprites.java.tpl'), 'utf8');
  put(join(javaDir, 'ThumbnailSprites.java'), Buffer.from(tpl.replaceAll('__APP_PACKAGE__', packageName)), check, changed);
  const srcDrawables = join(here, 'res', 'drawable');
  for (const f of readdirSync(srcDrawables)) {
    put(join(resDir, 'drawable', f), readFileSync(join(srcDrawables, f)), check, changed);
  }
  return changed;
}
