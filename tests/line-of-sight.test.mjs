import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TraversalGrid } from '../src/traversal-grid.js';
import { segmentBlocked } from '../src/line-of-sight.js';

function floorGrid() {
  const grid = new TraversalGrid();
  for (let x = -2; x <= 2; x += 0.2) {
    for (let z = -2; z <= 2; z += 0.2) grid.observe([x, -1.4, z]);
  }
  return grid;
}

test('open floor between two points does not block the sight line', () => {
  const grid = floorGrid();
  assert.equal(segmentBlocked(grid, [0, -0.4, 0], [0, -0.4, 2]), false);
});

test('a wall between camera and target blocks it', () => {
  const grid = floorGrid();
  // A slab of voxels standing at z = 1.0, spanning the body height.
  for (let x = -1; x <= 1; x += 0.1) {
    for (let y = -1.4; y <= -0.2; y += 0.1) grid.observe([x, y, 1.0]);
  }
  assert.equal(segmentBlocked(grid, [0, -0.6, 0], [0, -0.6, 2]), true);
});

test('unscanned space never blocks — absence of data is not an obstacle', () => {
  const grid = new TraversalGrid();
  assert.equal(segmentBlocked(grid, [0, 0, 0], [0, 0, 3]), false);
});

test('the surface the target stands on does not occlude the target', () => {
  const grid = floorGrid();
  // Camera low, target just above the floor: the floor voxels lie near the
  // line but inside the end clearance.
  assert.equal(segmentBlocked(grid, [0, -1.25, 0], [0, -1.3, 1.2]), false);
});

test('an obstacle immediately at the camera is ignored', () => {
  const grid = floorGrid();
  for (let y = -1.4; y <= 0; y += 0.1) grid.observe([0, y, 0.1]);
  // Within startClearM of the camera — the player's own hand or body.
  assert.equal(
    segmentBlocked(grid, [0, -0.6, 0], [0, -0.6, 0.5], { startClearM: 0.3, endClearM: 0.1 }),
    false,
  );
});

test('very short segments are never blocked', () => {
  const grid = floorGrid();
  assert.equal(segmentBlocked(grid, [0, -0.6, 0], [0, -0.6, 0.2]), false);
});

test('a missing grid or endpoint is handled rather than throwing', () => {
  assert.equal(segmentBlocked(null, [0, 0, 0], [1, 1, 1]), false);
  assert.equal(segmentBlocked(floorGrid(), null, [1, 1, 1]), false);
});

// ── graded visibility ────────────────────────────────────────
// A single centre ray is the wrong question: a thin obstacle across the middle
// must not read the same as a wall.

import { visibleFraction } from '../src/line-of-sight.js';
import { CAPTURE_VISIBLE_HIDDEN } from '../src/capture-gauge.js';

test('nothing in the way means fully visible', () => {
  const grid = floorGrid();
  assert.equal(visibleFraction(grid, [0, -0.9, 0], [0, -0.9, 1.5]), 1);
});

test('a narrow obstacle across the centre does not hide the whole body', () => {
  const grid = floorGrid();
  // The narrowest obstacle the grid can express is one 20cm cell — which is
  // already two thirds of a 30cm-wide character, so expect a real cost here,
  // not a graze. What matters is that it stays above the hidden threshold and
  // the capture keeps progressing.
  for (let y = -1.4; y <= -0.2; y += 0.05) grid.observe([0, y, 0.8]);

  const fraction = visibleFraction(grid, [0, -0.9, 0], [0, -0.9, 1.5]);
  assert.ok(
    fraction > CAPTURE_VISIBLE_HIDDEN,
    `a single column must not read as a wall, got ${fraction}`,
  );
  assert.ok(fraction < 1, 'it should still cost something');
});

test('a full wall hides the body completely', () => {
  const grid = floorGrid();
  for (let x = -1.5; x <= 1.5; x += 0.05) {
    for (let y = -1.6; y <= 0.4; y += 0.05) grid.observe([x, y, 0.8]);
  }
  assert.equal(visibleFraction(grid, [0, -0.9, 0], [0, -0.9, 1.5]), 0);
});

test('the sideways samples follow the view direction, not the world axes', () => {
  // Approaching along X rather than Z must give the same answer for the same
  // geometry rotated to match — otherwise coverage depends on where you stand.
  const alongZ = floorGrid();
  for (let y = -1.4; y <= -0.2; y += 0.05) alongZ.observe([0, y, 0.8]);
  const a = visibleFraction(alongZ, [0, -0.9, 0], [0, -0.9, 1.5]);

  const alongX = floorGrid();
  for (let y = -1.4; y <= -0.2; y += 0.05) alongX.observe([0.8, y, 0]);
  const b = visibleFraction(alongX, [0, -0.9, 0], [1.5, -0.9, 0]);

  assert.equal(a, b);
});

test('an unscanned room is treated as fully visible', () => {
  assert.equal(visibleFraction(new TraversalGrid(), [0, 0, 0], [0, 0, 2]), 1);
});

test('a missing grid does not throw', () => {
  assert.equal(visibleFraction(null, [0, 0, 0], [0, 0, 2]), 1);
});
