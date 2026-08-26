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

const { VoxelOccluder } = await import('../src/voxel-occluder.js');

function makeScene() {
  const added = [];
  return { added, add(o) { added.push(o); }, remove(o) { added.splice(added.indexOf(o), 1); } };
}
const cell = (ix, iy, iz) => ({ ix, iy, iz });

// Writing depth but no colour is the whole mechanism: the room's geometry
// lands in the depth buffer and the GPU hides the character behind it.
test('the material writes depth and no colour', () => {
  const occluder = new VoxelOccluder({ scene: makeScene() });
  assert.equal(occluder.material.colorWrite, false);
  assert.equal(occluder.material.depthWrite, true);
  assert.equal(occluder.material.depthTest, true);
  assert.equal(occluder.material.polygonOffset, true);
});

test('the mesh is added ahead of the runtime depth sources', () => {
  const scene = makeScene();
  const occluder = new VoxelOccluder({ scene });
  assert.equal(scene.added.length, 1);
  assert.equal(occluder.mesh.renderOrder, -3);
  assert.equal(occluder.mesh.frustumCulled, false);
  assert.equal(occluder.mesh.visible, false);
});

test('building fills the geometry and reports triangles', () => {
  const occluder = new VoxelOccluder({ scene: makeScene(), voxelSize: 0.1 });
  assert.equal(occluder.build([cell(0, 0, 0)], 1), 12);
  assert.ok(occluder.geometry.attributes.position.array instanceof Float32Array);
  assert.ok(occluder.geometry.index.array instanceof Uint32Array);
});

// Rebuilding every frame would throw away a buffer per frame; the revision
// gate is what keeps this a build-once mesh.
test('an unchanged revision skips the rebuild', () => {
  const occluder = new VoxelOccluder({ scene: makeScene(), voxelSize: 0.1 });
  occluder.build([cell(0, 0, 0)], 1);
  const geometry = occluder.geometry;
  occluder.build([cell(0, 0, 0), cell(5, 5, 5)], 1);
  assert.equal(occluder.geometry, geometry, 'same revision must not rebuild');

  occluder.build([cell(0, 0, 0), cell(5, 5, 5)], 2);
  assert.notEqual(occluder.geometry, geometry);
  assert.equal(geometry.disposed, true, 'the replaced geometry must be disposed');
});

test('visibility needs geometry behind it', () => {
  const occluder = new VoxelOccluder({ scene: makeScene(), voxelSize: 0.1 });
  occluder.setVisible(true);
  assert.equal(occluder.isVisible(), false, 'nothing built yet');

  occluder.build([cell(0, 0, 0)], 1);
  occluder.setVisible(true);
  assert.equal(occluder.isVisible(), true);
  occluder.setVisible(false);
  assert.equal(occluder.isVisible(), false);
});

test('changing the voxel size forces the next build', () => {
  const occluder = new VoxelOccluder({ scene: makeScene(), voxelSize: 0.05 });
  occluder.build([cell(0, 0, 0)], 1);
  occluder.setVoxelSize(0.03);
  assert.equal(occluder.build([cell(0, 0, 0)], 1), 12, 'must rebuild at the new scale');
});

test('reset clears the build and dispose detaches the mesh', () => {
  const scene = makeScene();
  const occluder = new VoxelOccluder({ scene, voxelSize: 0.1 });
  occluder.build([cell(0, 0, 0)], 1);
  occluder.reset();
  assert.equal(occluder.getTriangleCount(), 0);
  assert.equal(occluder.isVisible(), false);

  occluder.dispose();
  assert.equal(scene.added.length, 0);
});
