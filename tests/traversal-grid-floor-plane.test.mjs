// TraversalGrid RANSAC floor-plane support: correct the floor reference height
// from a fitted plane and fill sparse floor gaps within a bounded radius, so a
// conservative TSDF map still yields a continuous walkable floor. The fill must
// stay bounded (no filling real holes / unscanned void) and must not place a
// floor under furniture or walls.

import assert from 'node:assert/strict';
import test from 'node:test';

import { TraversalGrid } from '../src/traversal-grid.js';

const CELL = 0.2;
const SLAB = 0.1;

// A perfectly flat floor plane at height y.
function flatPlane(y) {
  return { a: 0, b: 0, c: y, slope: 0, inlierCount: 999, heightAt: () => y };
}

function makeGrid() {
  return new TraversalGrid({ cellSize: CELL, slabHeight: SLAB });
}

// Standable feet height for a floor voxel observed at surface height y: you
// stand on TOP of that voxel's slab.
function feetY(grid, surfaceY) {
  return grid.slabTopY(grid.slabOf(surfaceY));
}

test('applyFloorPlane does not move the floor height (no sink/float)', () => {
  const grid = makeGrid();
  for (let i = 0; i < 6; i += 1) for (let j = 0; j < 6; j += 1) grid.observe([i * CELL + 0.05, -1.0, j * CELL + 0.05]);

  const before = grid.slabTopY(grid.resolveFloorSlab());
  // Even a plane placed well below the observed floor must not lower the floor:
  // trusting a plane's absolute height is what sank the character.
  grid.applyFloorPlane(flatPlane(-1.6));
  const after = grid.slabTopY(grid.resolveFloorSlab());
  assert.ok(Math.abs(after - before) < 1e-9, 'the floor height stays with the observations');
});

test('fills sparse floor gaps within the fill radius', () => {
  const grid = makeGrid();
  grid.observe([0 * CELL + 0.05, -1.0, 0.05]); // cell (0,0)
  grid.observe([3 * CELL + 0.05, -1.0, 0.05]); // cell (3,0)
  assert.equal(grid.isWalkable(1, 0), false, 'gap starts unobserved');

  grid.applyFloorPlane(flatPlane(-1.0), { fillRadius: 2 });

  assert.ok(grid.isWalkable(1, 0), 'gap cell filled');
  assert.ok(grid.isWalkable(2, 0), 'gap cell filled');
  assert.ok(Math.abs(grid.levelY(1, 0, 0) - feetY(grid, -1.0)) < 1e-9, 'filled at floor height');
});

test('does not fill beyond the fill radius (real holes stay holes)', () => {
  const grid = makeGrid();
  grid.observe([0 * CELL + 0.05, -1.0, 0.05]); // cell (0,0) only
  grid.applyFloorPlane(flatPlane(-1.0), { fillRadius: 2 });
  assert.equal(grid.isWalkable(5, 0), false, 'a cell 5 away is not conjured into a floor');
});

test('does not fill a floor under furniture or a wall', () => {
  const grid = makeGrid();
  grid.observe([0 * CELL + 0.05, -1.0, 0.05]); // seed floor at (0,0)
  // Furniture body at cell (1,0): solid well above the floor, no floor voxel.
  grid.observe([1 * CELL + 0.05, -0.6, 0.05]);
  grid.observe([1 * CELL + 0.05, -0.5, 0.05]);

  grid.applyFloorPlane(flatPlane(-1.0), { fillRadius: 2 });

  const levels = grid.levels(1, 0);
  assert.ok(
    !levels.some((y) => Math.abs(y - feetY(grid, -1.0)) < 1e-9),
    'no synthetic floor placed beneath the furniture',
  );
});

test('floorBandVoxelPoints keeps only the low band, dropping high surfaces', () => {
  const grid = makeGrid();
  // Floor voxels near the bottom ...
  for (let i = 0; i < 6; i += 1) grid.observe([i * CELL + 0.05, -1.4, 0.05]);
  // ... and a ceiling well above the band.
  for (let i = 0; i < 6; i += 1) grid.observe([i * CELL + 0.05, 1.2, 0.05]);
  const band = grid.floorBandVoxelPoints({ bandM: 0.6, lowPercentile: 0.05 });
  assert.ok(band.length >= 6, 'floor voxels retained');
  assert.ok(band.every((p) => p[1] < 0), 'no ceiling voxels in the floor band');
});

test('reset clears the floor plane and falls back to the histogram', () => {
  const grid = makeGrid();
  grid.observe([0.05, -1.0, 0.05]);
  grid.applyFloorPlane(flatPlane(-1.0));
  grid.reset();
  assert.equal(grid.floorPlane, null);
  assert.equal(grid.resolveFloorSlab(), null, 'empty grid has no floor again');
});

test('occupiedVoxelPoints returns one point per occupied slab, in world space', () => {
  const grid = makeGrid();
  grid.observe([0.05, -1.0, 0.05]);
  grid.observe([0.05, -0.4, 0.05]);
  const points = grid.occupiedVoxelPoints();
  assert.equal(points.length, 2);
  const ys = points.map((p) => p[1]).sort((a, b) => a - b);
  // The heights the observations actually reported. Feeding RANSAC slab tops
  // handed it a 10cm staircase to fit, wider than its own 6cm inlier band.
  assert.ok(Math.abs(ys[0] - -1.0) < 1e-9, `got ${ys[0]}`);
  assert.ok(Math.abs(ys[1] - -0.4) < 1e-9, `got ${ys[1]}`);
});
