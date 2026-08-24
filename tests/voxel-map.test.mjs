import test from 'node:test';
import assert from 'node:assert/strict';

import { VoxelMap } from '../src/voxel-map.js';

test('a voxel becomes solid only after reaching the hit threshold', () => {
  const map = new VoxelMap({ voxelSize: 0.05, solidMinHits: 3 });
  assert.equal(map.observe([0.01, 0.01, 0.01]), false); // 1
  assert.equal(map.observe([0.02, 0.02, 0.02]), false); // 2 (same cell)
  assert.equal(map.observe([0.0, 0.0, 0.0]), true); // 3 -> solid
  assert.equal(map.observe([0.03, 0.0, 0.0]), false); // 4, already solid
  assert.equal(map.getSolidCount(), 1);
});

test('distinct cells are tracked separately and solids report centered positions', () => {
  const map = new VoxelMap({ voxelSize: 0.1, solidMinHits: 1 });
  map.observe([0.0, 0.0, 0.0]);
  map.observe([0.35, 0.0, 0.0]);
  assert.equal(map.getSolidCount(), 2);
  const positions = map.getSolidVoxels().map((v) => v.position[0]).sort((a, b) => a - b);
  assert.deepEqual(positions, [0.05, 0.35]); // cell centers at (floor+0.5)*size
});

test('solid list is capped by maxSolid', () => {
  const map = new VoxelMap({ voxelSize: 0.1, solidMinHits: 1, maxSolid: 1 });
  map.observe([0.0, 0.0, 0.0]);
  assert.equal(map.observe([0.5, 0.0, 0.0]), false); // capped, not added
  assert.equal(map.getSolidCount(), 1);
});

test('reset clears counts and solids', () => {
  const map = new VoxelMap({ solidMinHits: 1 });
  map.observe([0, 0, 0]);
  map.reset();
  assert.equal(map.getSolidCount(), 0);
});
