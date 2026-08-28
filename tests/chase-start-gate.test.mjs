// Regression: the chase must be able to START on a real, properly-walked room
// scan. When the default game terrain switched to the keyframe/TSDF pipeline it
// confirms voxels far more conservatively than the old legacy map, so the same
// walk yields fewer walkable cells. CHASE_MIN_WALKABLE_CELLS was tuned for the
// old dense terrain, so a genuine room scan fell under the gate and freezing the
// map never started the chase — Hachuping simply never appeared.
//
// The fixture is a real on-device capture (keyframe terrain, 9 keyframes, a
// 47-point walk) exported by the dev server. It stands in for the offline
// validation the terrain work was tuned against.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TraversalGrid } from '../src/traversal-grid.js';
import {
  CHASE_CELL_SIZE_M,
  CHASE_SLAB_HEIGHT_M,
  CHASE_MIN_WALKABLE_CELLS,
  CHASE_MAX_STAND_ABOVE_FLOOR_M,
  FLOOR_RANSAC_ITERATIONS,
  FLOOR_RANSAC_DISTANCE_M,
  FLOOR_RANSAC_MAX_TILT_DEG,
  FLOOR_RANSAC_MIN_INLIERS,
  FLOOR_RANSAC_KEEP_FRACTION,
  FLOOR_BAND_M,
  FLOOR_BAND_LOW_PERCENTILE,
  FLOOR_FILL_RADIUS_CELLS,
} from '../src/config.js';
import { chaseStartReadiness, gridCandidatePool } from '../src/grid-candidates.js';
import { fitFloorPlane } from '../src/plane-fit.js';

// Deterministic RNG so the RANSAC-based regression test never flakes.
function mulberry32(seed) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadRoomGrid() {
  const path = fileURLToPath(new URL('./fixtures/room-scan-keyframe.json', import.meta.url));
  const scan = JSON.parse(readFileSync(path, 'utf8'));
  // Every value main.js passes that changes the walkable count must be passed
  // here too. Leaving maxStandAboveFloor to the constructor default is what let
  // the 1.3 -> 0.85 change slip through: the grid under test was standing on
  // ceilings the shipped game rejects, so this measured 84 cells where the game
  // measured 77.
  const grid = new TraversalGrid({
    cellSize: CHASE_CELL_SIZE_M,
    slabHeight: CHASE_SLAB_HEIGHT_M,
    maxStandAboveFloor: CHASE_MAX_STAND_ABOVE_FLOOR_M,
  });
  // cells: [ix, iy, iz, count, cx, cy, cz] — world centre is columns 4..6, the
  // same value main.js feeds chaseGrid.observe(toMapSpace(center)).
  for (const c of scan.cells) grid.observe([c[4], c[5], c[6]]);
  return grid;
}

test('a real room scan has hiding spots to place Hachuping', () => {
  const grid = loadRoomGrid();
  assert.ok(gridCandidatePool(grid).length > 0, 'no candidate hiding spots in a real room scan');
});

test('a real room scan clears the walkable gate so the chase can start', () => {
  const grid = loadRoomGrid();
  const { walkable } = grid.stats();
  assert.ok(
    walkable >= CHASE_MIN_WALKABLE_CELLS,
    `a walked room yields ${walkable} walkable cells but the chase needs ${CHASE_MIN_WALKABLE_CELLS}; `
    + 'the gate is tuned above what the default terrain reaches, so the chase never starts',
  );
});

test('the RANSAC floor lifts walkable coverage past even the old 120-cell gate', () => {
  const grid = loadRoomGrid();
  const before = grid.stats().walkable;

  const points = grid.floorBandVoxelPoints({
    bandM: FLOOR_BAND_M,
    lowPercentile: FLOOR_BAND_LOW_PERCENTILE,
  });
  const plane = fitFloorPlane(points, {
    iterations: FLOOR_RANSAC_ITERATIONS,
    distanceThreshold: FLOOR_RANSAC_DISTANCE_M,
    maxTiltDeg: FLOOR_RANSAC_MAX_TILT_DEG,
    minInliers: FLOOR_RANSAC_MIN_INLIERS,
    keepFraction: FLOOR_RANSAC_KEEP_FRACTION,
    rng: mulberry32(20260826),
  });
  assert.ok(plane, 'expected a floor plane on a real room scan');
  assert.ok(plane.slope < Math.tan((FLOOR_RANSAC_MAX_TILT_DEG * Math.PI) / 180) + 1e-9, 'floor stays near-horizontal');

  grid.applyFloorPlane(plane, { fillRadius: FLOOR_FILL_RADIUS_CELLS });
  const after = grid.stats().walkable;

  assert.ok(after > before, `RANSAC fill should grow walkable cells (${before} -> ${after})`);
  assert.ok(after >= 120, `RANSAC floor should recover the old 120-cell gate (got ${after})`);
});
test('chase start stays disabled when a short scan has too few walkable cells', () => {
  assert.deepEqual(
    chaseStartReadiness({ walkable: 12, candidateCount: 4, minWalkable: 80 }),
    { ready: false, reason: 'insufficient-walkable' },
  );
});

test('chase start requires both enough floor and at least one hiding candidate', () => {
  assert.deepEqual(
    chaseStartReadiness({ walkable: 100, candidateCount: 0, minWalkable: 80 }),
    { ready: false, reason: 'no-candidates' },
  );
  assert.deepEqual(
    chaseStartReadiness({ walkable: 100, candidateCount: 3, minWalkable: 80 }),
    { ready: true, reason: null },
  );
});
