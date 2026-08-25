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
  assert.equal(map.getPendingCount(), 0);
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
  assert.equal(map.getPendingCount(), 0);
});

test('bounds one-off noise cells by evicting the oldest pending observation', () => {
  const map = new VoxelMap({
    voxelSize: 0.1,
    solidMinHits: 3,
    maxSolid: 10,
    maxPending: 2,
  });
  map.observe([0, 0, 0]);
  map.observe([1, 0, 0]);
  map.observe([2, 0, 0]);

  assert.equal(map.getPendingCount(), 2);
});

test('stops retaining pending counts after the solid map reaches capacity', () => {
  const map = new VoxelMap({
    voxelSize: 0.1,
    solidMinHits: 1,
    maxSolid: 1,
    maxPending: 10,
  });
  map.observe([0, 0, 0]);
  map.observe([1, 0, 0]);

  assert.equal(map.getSolidCount(), 1);
  assert.equal(map.getPendingCount(), 0);
});

test('increments the map revision only when visible solid voxels change', () => {
  const map = new VoxelMap({ voxelSize: 0.1, solidMinHits: 2 });
  assert.equal(map.getRevision(), 0);
  map.observe([0, 0, 0]);
  assert.equal(map.getRevision(), 0);
  map.observe([0, 0, 0]);
  assert.equal(map.getRevision(), 1);
  map.observe([0, 0, 0]);
  assert.equal(map.getRevision(), 1);
  map.reset();
  assert.equal(map.getRevision(), 2);
});
