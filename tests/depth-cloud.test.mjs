import test from 'node:test';
import assert from 'node:assert/strict';

import { depthSampleToWorld, voxelKey } from '../src/depth-math.js';

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ≈ ${expected}`,
  );
}

test('center sample projects straight ahead at the given depth', () => {
  // Identity projection: NDC == view. Center pixel (0.5, 0.5), depth 2m.
  const point = depthSampleToWorld(0.5, 0.5, 2, IDENTITY, IDENTITY);
  approx(point[0], 0);
  approx(point[1], 0);
  approx(point[2], -2); // camera looks down -Z
});

test('view-space y is flipped (top of image is up)', () => {
  const top = depthSampleToWorld(0.5, 0, 2, IDENTITY, IDENTITY);
  const bottom = depthSampleToWorld(0.5, 1, 2, IDENTITY, IDENTITY);
  approx(top[1], 2); // v=0 (top) -> +y
  approx(bottom[1], -2); // v=1 (bottom) -> -y
});

test('right edge sample lands on +x', () => {
  const point = depthSampleToWorld(1, 0.5, 2, IDENTITY, IDENTITY);
  approx(point[0], 2);
});

test('view matrix transforms the reconstructed point into world space', () => {
  // 90° rotation about Y (column-major): view -Z maps to world -X.
  const rotateY90 = [
    0, 0, -1, 0,
    0, 1, 0, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  ];
  const point = depthSampleToWorld(0.5, 0.5, 2, IDENTITY, rotateY90);
  approx(point[0], -2);
  approx(point[1], 0);
  approx(point[2], 0);
});

test('view translation offsets the world point', () => {
  const translate = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 2, 3, 1,
  ];
  const point = depthSampleToWorld(0.5, 0.5, 2, IDENTITY, translate);
  approx(point[0], 1);
  approx(point[1], 2);
  approx(point[2], 1); // -2 forward + 3 offset
});

test('invalid or non-positive depth yields no point', () => {
  assert.equal(depthSampleToWorld(0.5, 0.5, 0, IDENTITY, IDENTITY), null);
  assert.equal(depthSampleToWorld(0.5, 0.5, -1, IDENTITY, IDENTITY), null);
  assert.equal(depthSampleToWorld(0.5, 0.5, NaN, IDENTITY, IDENTITY), null);
});

test('voxel key buckets nearby points together and separates distant ones', () => {
  const size = 0.05;
  assert.equal(voxelKey(0.011, 0.02, 0.03, size), voxelKey(0.014, 0.021, 0.019, size));
  assert.notEqual(voxelKey(0, 0, 0, size), voxelKey(0.2, 0, 0, size));
});
