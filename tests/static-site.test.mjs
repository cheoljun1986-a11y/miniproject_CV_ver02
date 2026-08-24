import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('GitHub Pages entrypoint loads the application through a relative ES module', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const moduleScripts = [...html.matchAll(/<script\s+type="module"([^>]*)>([\s\S]*?)<\/script>/g)];

  assert.equal(moduleScripts.length, 1);
  assert.match(moduleScripts[0][1], /src="\.\/src\/main\.js"/);
  assert.equal(moduleScripts[0][2].trim(), '');
});

