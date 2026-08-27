import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const page of ['app.html', 'v4-chase.html']) {
  test(`${page} contains the Catch! Teenieping celebration overlay`, async () => {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(html, /id=(?:"|')catchCelebrationOverlay(?:"|')/);
    assert.match(html, /id=(?:"|')catchTeeniepingLogo(?:"|')/);
    assert.match(html, /src=(?:"|')\.\/assets\/catch-teenieping-logo-ko\.png(?:"|')/);
    assert.doesNotMatch(html, /rpsOverlay|manualRock|handPreviewMount/);
  });
}

test('application no longer wires the hand duel runtime', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /RpsRuntime|HandGestureRecognizer|GestureConsensus|RawCameraFrameSource/);
  assert.doesNotMatch(main, /rpsRuntime|onDuelStart/);
  assert.match(main, /if \(capture\.captured\)[\s\S]*?game\.startCatchCelebration\(\)/);
});

test('bundled Catch! Teenieping logo is a non-empty PNG asset', async () => {
  const logo = await readFile(
    new URL('../assets/catch-teenieping-logo-ko.png', import.meta.url),
  );
  assert.ok(logo.byteLength > 100_000);
  assert.equal(logo.readUInt32BE(16), 1017);
  assert.equal(logo.readUInt32BE(20), 722);
  assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
test('PC catch preview exposes the replayable two-turn effect', async () => {
  const html = await readFile(new URL('../catch-preview.html', import.meta.url), 'utf8');
  assert.match(html, /catchTeeniepingLogo/);
  assert.match(html, /catchCharacter/);
  assert.match(html, /rotateY\(720deg\)/);
  assert.match(html, /다시 보기/);
});