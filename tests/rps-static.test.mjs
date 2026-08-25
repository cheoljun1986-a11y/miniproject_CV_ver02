import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('entrypoint contains the complete rock paper scissors duel overlay', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const quote = String.fromCharCode(34);
  for (const id of [
    'rpsOverlay', 'rpsCountdown', 'handStatus', 'playerMoveCanvas',
    'ninjaMoveCanvas', 'playerMoveLabel', 'ninjaMoveLabel', 'rpsResult',
    'rpsError', 'manualMoves', 'manualRock', 'manualPaper', 'manualScissors',
  ]) {
    assert.match(html, new RegExp(`id=(?:${quote}|')${id}(?:${quote}|')`));
  }
});
