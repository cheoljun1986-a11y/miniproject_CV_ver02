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

const { MeshOverlay } = await import('../src/mesh-overlay.js');

function scene() {
  const added = [];
  return { add: (o) => added.push(o), remove: () => {}, added };
}

// A field with one horizontal sign change, so Surface Nets has something real
// to extract: negative below y = 0, positive above.
function field({ revision = 1, lo = -3, hi = 3 } = {}) {
  const cells = [];
  for (let ix = lo; ix <= hi; ix += 1) {
    for (let iy = lo; iy <= hi; iy += 1) {
      for (let iz = lo; iz <= hi; iz += 1) {
        cells.push({ ix, iy, iz, tsdf: (iy + 0.5) * 0.05, weight: 5 });
      }
    }
  }
  return {
    voxelSize: 0.05,
    origin: [0, 0, 0],
    getCells: () => cells,
    getRevision: () => revision,
  };
}

test('a hidden overlay still builds, so showing it is instant', () => {
  const overlay = new MeshOverlay({ scene: scene() });
  assert.equal(overlay.isVisible(), false);
  assert.ok(overlay.build(field(), 1) > 0);
});

test('extraction is skipped when the map has not moved on', () => {
  const overlay = new MeshOverlay({ scene: scene() });
  const first = overlay.build(field(), 7);
  assert.ok(first > 0);

  // Same revision, a field that would mesh differently: must not re-extract.
  const bigger = field({ lo: -6, hi: 6 });
  assert.equal(overlay.build(bigger, 7), first, 'reused the previous build');
  assert.ok(overlay.build(bigger, 8) > first, 'a new revision rebuilds');
});

test('a missing field leaves the overlay empty rather than throwing', () => {
  const overlay = new MeshOverlay({ scene: scene() });
  assert.equal(overlay.build(null, 1), 0);
  assert.equal(overlay.getTriangleCount(), 0);
});

// The render contract the diagnostic depends on. depthWrite true would put the
// diagnostic layer into the depth buffer and make the character disappear
// behind it; renderOrder below the character would hide the surface instead.
test('it draws above the character without writing depth', () => {
  const overlay = new MeshOverlay({ scene: scene() });
  assert.equal(overlay.mesh.material.depthWrite, false);
  assert.equal(overlay.mesh.renderOrder, 3);
  assert.equal(overlay.mesh.frustumCulled, false);
  assert.equal(overlay.mesh.visible, false, 'starts hidden');
});

test('clearing drops the geometry and forces the next build to run', () => {
  const overlay = new MeshOverlay({ scene: scene() });
  overlay.build(field(), 3);
  overlay.setVisible(true);

  overlay.clear();
  assert.equal(overlay.getTriangleCount(), 0);
  // Same revision as before: without the reset this would be skipped.
  assert.ok(overlay.build(field(), 3) > 0);
});

test('only cells with enough evidence take part', () => {
  const overlay = new MeshOverlay({ scene: scene() });
  const thin = field();
  for (const cell of thin.getCells()) cell.weight = 1;
  assert.equal(overlay.build(thin, 1, { minWeight: 3 }), 0, 'one-look cells cannot mesh');
  assert.ok(overlay.build(thin, 2, { minWeight: 1 }) > 0);
});
