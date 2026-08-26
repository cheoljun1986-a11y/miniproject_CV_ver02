import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('AR entrypoint contains the complete rock paper scissors duel overlay', async () => {
  const html = await readFile(new URL('../app.html', import.meta.url), 'utf8');
  const quote = String.fromCharCode(34);
  for (const id of [
    'rpsOverlay', 'rpsCountdown', 'handStatus', 'playerMoveCanvas',
    'ninjaMoveCanvas', 'playerMoveLabel', 'ninjaMoveLabel', 'rpsResult',
    'rpsError', 'manualMoves', 'manualRock', 'manualPaper', 'manualScissors',
    'handPreviewFrame', 'handPreviewMount',
  ]) {
    assert.match(html, new RegExp(`id=(?:${quote}|')${id}(?:${quote}|')`));
  }
});

test('application wires camera access and duel runtime into the XR lifecycle', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /new RpsRuntime/);
  assert.match(main, /camera-access/);
  assert.match(main, /rpsRuntime\??\.startSession/);
  assert.match(main, /rpsRuntime\??\.update/);
  assert.match(main, /rpsRuntime\??\.resetSession/);
});

test('pinned gesture model matches the reviewed Google asset', async () => {
  const model = await readFile(
    new URL('../assets/gesture_recognizer.task', import.meta.url),
  );
  assert.equal(model.byteLength, 8373440);
  assert.equal(
    createHash('sha256').update(model).digest('hex'),
    '97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482',
  );
});
