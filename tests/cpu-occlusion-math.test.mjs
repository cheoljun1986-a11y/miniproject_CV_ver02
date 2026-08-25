import test from 'node:test';
import assert from 'node:assert/strict';

import {
  depthWithOcclusionBias,
  isUsableDepth,
  triangleFits,
  writeGridTriangleIndices,
} from '../src/cpu-occlusion-math.js';

test('occlusion bias moves a valid real surface slightly behind its measured depth', () => {
  assert.equal(depthWithOcclusionBias(2, 0.05, 6), 2.05);
  assert.equal(depthWithOcclusionBias(0, 0.05, 6), null);
  assert.equal(depthWithOcclusionBias(Number.NaN, 0.05, 6), null);
});

test('a valid 2 by 2 grid produces two triangles with consistent winding', () => {
  const indices = new Uint16Array(6);
  const count = writeGridTriangleIndices(
    new Float32Array([1, 1, 1, 1]),
    2,
    2,
    indices,
    0.2,
    6,
  );

  assert.equal(count, 6);
  assert.deepEqual([...indices], [0, 2, 1, 1, 2, 3]);
});

test('invalid depth removes only triangles that use the invalid vertex', () => {
  const indices = new Uint16Array(6);
  const count = writeGridTriangleIndices(
    new Float32Array([0, 1, 1, 1]),
    2,
    2,
    indices,
    0.2,
    6,
  );

  assert.equal(count, 3);
  assert.deepEqual([...indices.slice(0, count)], [1, 2, 3]);
  assert.equal(isUsableDepth(Number.NaN, 6), false);
  assert.equal(isUsableDepth(6.01, 6), false);
});

test('depth discontinuities are rejected beyond the configured boundary', () => {
  assert.equal(triangleFits([1, 1.1, 1.2], 0.2, 6), true);
  assert.equal(triangleFits([1, 1.1, 1.21], 0.2, 6), false);
});

test('the writer never emits a partial triangle past index capacity', () => {
  const indices = new Uint16Array(4);
  const count = writeGridTriangleIndices(
    new Float32Array([1, 1, 1, 1]),
    2,
    2,
    indices,
    0.2,
    6,
  );

  assert.equal(count, 3);
  assert.deepEqual([...indices.slice(0, count)], [0, 2, 1]);
});
