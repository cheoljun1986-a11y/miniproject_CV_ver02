import test from 'node:test';
import assert from 'node:assert/strict';

import { framePoints } from '../src/operator-framing.js';

test('reports no framing for an empty map', () => {
  assert.equal(framePoints([], 60), null);
});

test('targets the center of the reconstructed points', () => {
  const framing = framePoints([[0, 0, 0], [2, 4, 6]], 60);

  assert.deepEqual(framing.target, [1, 2, 3]);
});

test('backs the camera off far enough to contain the points', () => {
  const framing = framePoints([[-1, 0, 0], [1, 0, 0]], 60);

  // Half-extent is 1, so the camera must sit farther than that from the center.
  assert.ok(framing.distance > 1);
});

test('a wider map pushes the camera farther back', () => {
  const near = framePoints([[-1, 0, 0], [1, 0, 0]], 60);
  const far = framePoints([[-5, 0, 0], [5, 0, 0]], 60);

  assert.ok(far.distance > near.distance);
});

test('a narrow field of view needs more distance than a wide one', () => {
  const wide = framePoints([[-1, 0, 0], [1, 0, 0]], 90);
  const narrow = framePoints([[-1, 0, 0], [1, 0, 0]], 30);

  assert.ok(narrow.distance > wide.distance);
});

test('keeps a usable distance when every point sits in one spot', () => {
  const framing = framePoints([[3, 1, -2], [3, 1, -2]], 60);

  assert.deepEqual(framing.target, [3, 1, -2]);
  assert.ok(framing.distance > 0);
  assert.ok(Number.isFinite(framing.distance));
});
