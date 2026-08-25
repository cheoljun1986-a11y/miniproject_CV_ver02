import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFit, createInstanceFrom, fitToHeight } from '../src/hidden-model.js';

// Minimal stand-ins for the three.js objects these helpers touch. They only
// need clone/traverse and the scale/position writers, so no three.js import.
function makeMaterial(name) {
  return {
    name,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    clone() { return makeMaterial(name); },
  };
}

function makeObject({ material = null, children = [] } = {}) {
  return {
    material,
    children,
    scale: { value: 1, setScalar(value) { this.value = value; } },
    position: {
      x: 0,
      y: 0,
      z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
    traverse(visit) {
      visit(this);
      for (const child of this.children) child.traverse(visit);
    },
    clone() {
      return makeObject({
        material: this.material,
        children: this.children.map((child) => child.clone()),
      });
    },
  };
}

test('scales a bounding box down to the requested height', () => {
  const { scale } = fitToHeight([-1, -1, -1], [1, 1, 1], 0.5);

  assert.equal(scale, 0.25);
});

test('offsets the scaled model so its lowest point rests on y = 0', () => {
  const { scale, offset } = fitToHeight([-1, -2, -1], [1, 2, 1], 0.5);

  assert.equal(-2 * scale + offset[1], 0);
});

test('centers the scaled model horizontally on the origin', () => {
  const { scale, offset } = fitToHeight([0, 0, 2], [4, 1, 6], 0.5);

  assert.equal(0 * scale + offset[0], -(4 * scale) / 2);
  assert.equal(2 * scale + offset[2], -(4 * scale) / 2);
});

test('keeps the original scale when the bounding box has no height', () => {
  const { scale, offset } = fitToHeight([-1, 3, -1], [1, 3, 1], 0.5);

  assert.equal(scale, 1);
  assert.deepEqual(offset, [0, -3, 0]);
});

test('applies the fit as a uniform scale and a position offset', () => {
  const object = makeObject();

  applyFit(object, { scale: 0.25, offset: [1, 2, 3] });

  assert.equal(object.scale.value, 0.25);
  assert.deepEqual([object.position.x, object.position.y, object.position.z], [1, 2, 3]);
});

test('gives each instance its own materials so one can fade without the others', () => {
  const shared = makeMaterial('body');
  const template = makeObject({ children: [makeObject({ material: shared })] });

  const first = createInstanceFrom(template, 0.13);
  const second = createInstanceFrom(template, 0.13);

  assert.notEqual(first.children[0].material, shared);
  assert.notEqual(first.children[0].material, second.children[0].material);
});

test('makes an instance translucent at the requested camouflage opacity', () => {
  const template = makeObject({ children: [makeObject({ material: makeMaterial('body') })] });

  const instance = createInstanceFrom(template, 0.13);

  const { transparent, opacity, depthWrite } = instance.children[0].material;
  assert.equal(transparent, true);
  assert.equal(opacity, 0.13);
  assert.equal(depthWrite, false);
});

test('leaves an opaque instance writing depth so it does not self-blend', () => {
  const template = makeObject({ children: [makeObject({ material: makeMaterial('body') })] });

  const instance = createInstanceFrom(template, 1);

  assert.equal(instance.children[0].material.depthWrite, true);
});
