import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterDepthGrid,
  isDepthInRange,
  isDepthMeasured,
  neighborGradientOk,
} from '../src/depth-grid-filter.js';

test('range clipping is inclusive at both ends and rejects non-finite depth', () => {
  assert.equal(isDepthInRange(0.29, 0.3, 5.0), false);
  assert.equal(isDepthInRange(0.3, 0.3, 5.0), true);
  assert.equal(isDepthInRange(5.0, 0.3, 5.0), true);
  assert.equal(isDepthInRange(5.01, 0.3, 5.0), false);
  assert.equal(isDepthInRange(NaN, 0.3, 5.0), false);
  assert.equal(isDepthInRange(Infinity, 0.3, 5.0), false);
  assert.equal(isDepthMeasured(0), false);
  assert.equal(isDepthMeasured(1.5), true);
});

test('any single neighbour over the jump limit rejects the pixel', () => {
  // 3x3, centre 1.0 surrounded by 1.05
  const flat = [1.05, 1.05, 1.05, 1.05, 1.0, 1.05, 1.05, 1.05, 1.05];
  assert.equal(neighborGradientOk(flat, 3, 3, 1, 1, 0.10), true);

  const edged = flat.slice();
  edged[1] = 1.20; // the neighbour above
  assert.equal(neighborGradientOk(edged, 3, 3, 1, 1, 0.10), false);
});

test('border pixels are judged on the neighbours they have', () => {
  const depths = [1.0, 1.02, 1.03, 1.01, 1.0, 1.02, 1.0, 1.01, 1.0];
  assert.equal(neighborGradientOk(depths, 3, 3, 0, 1, 0.10), true); // left edge
  assert.equal(neighborGradientOk(depths, 3, 3, 0, 0, 0.10), true); // corner

  const cliff = depths.slice();
  cliff[3] = 1.0;
  cliff[4] = 2.0; // right neighbour of the left-edge pixel
  assert.equal(neighborGradientOk(cliff, 3, 3, 0, 1, 0.10), false);
});

// ARCore CPU depth is full of zero holes. Rejecting every pixel next to a hole
// empties the map and masquerades as a depth-acquisition failure.
test('missing neighbours are skipped by default and rejected only on request', () => {
  const holed = [0, 0, 0, 0, 1.0, 1.02, 0, 1.01, 0];
  assert.equal(neighborGradientOk(holed, 3, 3, 1, 1, 0.10), true);
  assert.equal(
    neighborGradientOk(holed, 3, 3, 1, 1, 0.10, { rejectOnMissingNeighbor: true }),
    false,
  );
});

test('a non-positive jump limit turns the gradient check off', () => {
  const cliff = [9, 9, 9, 9, 1.0, 9, 9, 9, 9];
  assert.equal(neighborGradientOk(cliff, 3, 3, 1, 1, 0), true);
  assert.equal(neighborGradientOk(cliff, 3, 3, 1, 1, -1), true);
});

test('filterDepthGrid visits the accepted samples and its counters sum to total', () => {
  const depths = [
    0, 1.0, 1.01,
    1.0, 1.0, 9.9,
    1.02, 1.0, 0.1,
  ];
  const seen = [];
  const stats = filterDepthGrid(
    { depths, width: 3, height: 3 },
    { nearM: 0.3, farM: 5.0, gradientMaxJumpM: 0.10 },
    (col, row, depth) => seen.push([col, row, depth]),
  );

  assert.equal(stats.total, 9);
  assert.equal(stats.accepted, seen.length);
  assert.equal(
    stats.rejectedZero + stats.rejectedRange + stats.rejectedGradient + stats.accepted,
    stats.total,
  );
  assert.equal(stats.rejectedZero, 1);
  assert.equal(stats.rejectedRange, 2); // 9.9 is far, 0.1 is near
});

test('an all-zero grid accepts nothing', () => {
  const stats = filterDepthGrid(
    { depths: new Float32Array(16), width: 4, height: 4 },
    { nearM: 0.3, farM: 5.0, gradientMaxJumpM: 0.10 },
    () => { throw new Error('must not visit'); },
  );
  assert.equal(stats.accepted, 0);
  assert.equal(stats.rejectedZero, 16);
});
