import test from 'node:test';
import assert from 'node:assert/strict';

const { resolveInputMode } = await import('../src/input-mode.js');

test('manual input requires an explicit query value', () => {
  assert.equal(resolveInputMode(''), 'camera');
  assert.equal(resolveInputMode('?occlusion=cpu'), 'camera');
  assert.equal(resolveInputMode('?input=manual'), 'manual');
  assert.equal(resolveInputMode('?occlusion=cpu&input=manual'), 'manual');
  assert.equal(resolveInputMode('?input=MANUAL'), 'camera');
});
