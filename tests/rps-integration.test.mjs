import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const threeStubUrl = new URL('./support/three-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: threeStubUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { resolveInputMode } = await import('../src/input-mode.js');
const { clearNinjaMove, showNinjaMove } = await import('../src/rps-sign.js');

test('manual input requires an explicit query value', () => {
  assert.equal(resolveInputMode(''), 'camera');
  assert.equal(resolveInputMode('?occlusion=cpu'), 'camera');
  assert.equal(resolveInputMode('?input=manual'), 'manual');
  assert.equal(resolveInputMode('?occlusion=cpu&input=manual'), 'manual');
  assert.equal(resolveInputMode('?input=MANUAL'), 'camera');
});

function makeCanvas() {
  const context = {
    canvas: { width: 256, height: 256 },
    clearRect() {}, save() {}, restore() {}, scale() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, arc() {}, fill() {}, stroke() {},
  };
  return { width: 0, height: 0, getContext: () => context };
}

function makeRoot() {
  return {
    children: [],
    add(object) { this.children.push(object); },
    remove(object) { this.children = this.children.filter((item) => item !== object); },
  };
}

test('ninja move sign replaces and disposes the previous graphic', () => {
  const root = makeRoot();
  const first = showNinjaMove(root, 'rock', { canvasFactory: makeCanvas });
  assert.equal(root.children.length, 1);
  assert.equal(first.name, 'rpsMoveSign');
  assert.deepEqual(first.position.values, [0, 0.72, 0]);
  assert.deepEqual(first.scale.values, [0.42, 0.42, 1]);

  const second = showNinjaMove(root, 'paper', { canvasFactory: makeCanvas });
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0], second);
  assert.equal(first.material.disposed, true);
  assert.equal(first.material.map.disposed, true);

  assert.equal(clearNinjaMove(root), true);
  assert.equal(root.children.length, 0);
  assert.equal(second.material.disposed, true);
  assert.equal(clearNinjaMove(root), false);
});
