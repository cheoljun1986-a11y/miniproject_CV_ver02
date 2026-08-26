import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('GitHub Pages entrypoint presents the mode launcher', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const moduleScripts = [...html.matchAll(/<script\s+type="module"([^>]*)>([\s\S]*?)<\/script>/g)];

  assert.equal(moduleScripts.length, 0);
  assert.match(html, /href="\.\/v4-chase\.html"/);
  assert.doesNotMatch(html, /href="\.\/app\.html\?occlusion=cpu"/);
  assert.match(html, /href="\.\/app\.html\?depth=cloud"/);
  assert.match(html, /href="\.\/app\.html\?voxel=debug"/);
  assert.equal([...html.matchAll(/class="tool-card"/g)].length, 2);
});

test('legacy root query links redirect to the application page', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /location\.search/);
  assert.match(html, /location\.replace\([^)]*app\.html/);
});

test('application page loads the shared module and keeps the operator status', async () => {
  const html = await readFile(new URL('../app.html', import.meta.url), 'utf8');
  const moduleScripts = [...html.matchAll(/<script\s+type="module"([^>]*)>([\s\S]*?)<\/script>/g)];

  assert.equal(moduleScripts.length, 1);
  assert.match(moduleScripts[0][1], /src="\.\/src\/main\.js"/);
  assert.match(html, /id="operatorStatus"/);
});
