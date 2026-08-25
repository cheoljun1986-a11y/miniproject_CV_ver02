import test from 'node:test';
import assert from 'node:assert/strict';

import {
  orientNormalTowardViewer,
  placeNinjaOnSurface,
  surfaceNormalFromMatrix,
} from '../src/surface-placement.js';

test('extracts and normalizes the local Y axis from a column-major surface matrix', () => {
  assert.deepEqual(surfaceNormalFromMatrix([
    1, 0, 0, 0,
    0, 2, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]), [0, 1, 0]);
});

test('flips a surface normal that points away from the viewer', () => {
  assert.deepEqual(
    orientNormalTowardViewer([0, 0, -1], [0, 1, -2], [0, 1, 0]),
    [0, 0, 1],
  );
});

test('offsets a vertical surface 12cm toward the viewer', () => {
  const result = placeNinjaOnSurface({
    pos: [0, 1, -2],
    matrix: [
      1, 0, 0, 0,
      0, 0, -1, 0,
      0, 1, 0, 0,
      0, 1, -2, 1,
    ],
  }, [0, 1, 0]);

  assert.deepEqual(result.normal, [0, 0, 1]);
  assert.deepEqual(result.position, [0, 1, -1.88]);
  assert.equal(result.horizontal, false);
  assert.equal(result.offset, 0.12);
});

test('offsets a horizontal surface 2cm while keeping the placement upright', () => {
  const result = placeNinjaOnSurface({
    pos: [1, 0, -2],
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      1, 0, -2, 1,
    ],
  }, [0, 1.6, 0]);

  assert.deepEqual(result.position, [1, 0.02, -2]);
  assert.equal(result.horizontal, true);
  assert.equal(result.offset, 0.02);
});

test('falls back to an upward normal when the surface matrix has no usable Y axis', () => {
  assert.deepEqual(surfaceNormalFromMatrix(new Array(16).fill(0)), [0, 1, 0]);
});
