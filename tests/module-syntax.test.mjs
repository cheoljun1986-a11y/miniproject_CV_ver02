import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

// A missing closing brace in main.js shipped to the phone and stopped the page
// dead at "WebXR 확인 중…", because the browser could not parse the module at
// all. Nothing caught it: main.js has no unit tests (it is the wiring layer),
// and `node --check <file>` treats a bare .js file as CommonJS, where the same
// text parses. Only module parsing reproduces what the browser does, and
// --input-type applies to stdin, so the source has to be piped in.
//
// This is the cheapest possible guard against a whole page failing to boot.
test('every src module parses as an ES module, the way the browser loads it', async () => {
  const files = (await readdir(SRC)).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 10, 'expected to find the source modules');

  const failures = [];
  for (const name of files) {
    const source = await readFile(SRC + name, 'utf8');
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--check'],
      { input: source, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      const first = String(result.stderr ?? '')
        .split('\n')
        .find((line) => line.includes('SyntaxError')) ?? 'parse failed';
      failures.push(`${name}: ${first.trim()}`);
    }
  }
  assert.deepEqual(failures, [], `modules failed to parse:\n${failures.join('\n')}`);
});
