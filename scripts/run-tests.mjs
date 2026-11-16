// scripts/run-tests.mjs - Shell-independent test runner for CineStream
import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const files = globSync(['src/**/*.test.ts', 'scripts/**/*.test.ts']).sort();

if (files.length === 0) {
  console.error('No test files found in', root);
  process.exit(1);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const res = spawnSync(npx, ['tsx', '--test', ...files], { stdio: 'inherit', shell: true });
process.exit(res.status ?? 0);
