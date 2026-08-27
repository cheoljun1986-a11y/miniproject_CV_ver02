import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFit,
  applyForwardYaw,
  MODEL_FORWARD_YAW,
  createInstanceFrom,
  fitToHeight,
  srgbAttributeToLinear,
  srgbToLinear,
} from '../src/hidden-model.js';

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
    rotation: { x: 0, y: 0, z: 0 },
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

test('converts a mid sRGB value to its linear equivalent', () => {
  assert.ok(Math.abs(srgbToLinear(0.5) - 0.21404) < 1e-4);
});

test('uses the linear segment for very dark sRGB values', () => {
  assert.equal(srgbToLinear(0.04), 0.04 / 12.92);
});

test('keeps the endpoints of the sRGB range fixed', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.ok(Math.abs(srgbToLinear(1) - 1) < 1e-6);
});

test('converts byte vertex colors to linear floats', () => {
  const linear = srgbAttributeToLinear(Uint8Array.from([191, 135, 138, 255]), 4, 255);

  assert.ok(Math.abs(linear[0] - srgbToLinear(191 / 255)) < 1e-6);
  assert.ok(Math.abs(linear[1] - srgbToLinear(135 / 255)) < 1e-6);
  assert.ok(Math.abs(linear[2] - srgbToLinear(138 / 255)) < 1e-6);
});

test('leaves alpha untouched while converting colors', () => {
  const linear = srgbAttributeToLinear(Uint8Array.from([255, 0, 0, 128]), 4, 255);

  assert.ok(Math.abs(linear[3] - 128 / 255) < 1e-6);
});

test('converts every vertex in a multi-vertex attribute', () => {
  const linear = srgbAttributeToLinear(Float32Array.from([1, 1, 1, 0.5, 0.5, 0.5]), 3, 1);

  assert.ok(Math.abs(linear[0] - 1) < 1e-6);
  assert.ok(Math.abs(linear[3] - srgbToLinear(0.5)) < 1e-6);
});

// ── model forward axis ───────────────────────────────────────
// The chase aims the model's local +Z along its direction of travel. hcp.glb is
// a trimesh scan with identity node transforms, so its own front is NOT +Z and
// the character moonwalks — faces where it came from while sliding the other
// way. Nothing else in the codebase pins this, so it is pinned here.

test('the scanned model is turned so its front faces +Z', () => {
  const object = makeObject();

  applyForwardYaw(object);

  assert.equal(object.rotation.y, MODEL_FORWARD_YAW);
  assert.ok(Math.abs(MODEL_FORWARD_YAW - Math.PI) < 1e-9, 'a half turn, not an arbitrary yaw');
});

test('the correction adds to whatever yaw the object already carries', () => {
  const object = makeObject();
  object.rotation.y = 0.5;

  applyForwardYaw(object);

  assert.ok(Math.abs(object.rotation.y - (0.5 + MODEL_FORWARD_YAW)) < 1e-9);
});

// Two half turns are identity: this is what makes the fix safe to reason about,
// and it is why the correction must live in exactly ONE place. Flipping the
// heading as well would cancel it and the character would moonwalk again.
test('applying the correction twice returns the model to where it started', () => {
  const object = makeObject();

  applyForwardYaw(object);
  applyForwardYaw(object);

  assert.ok(Math.abs(Math.cos(object.rotation.y) - 1) < 1e-9, 'back to facing its own front');
});
