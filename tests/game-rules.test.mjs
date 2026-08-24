import test from 'node:test';
import assert from 'node:assert/strict';

import {
  forwardFromQuaternion,
  isDetected,
  measureTarget,
  rankCandidates,
} from '../src/game-rules.js';

test('isDetected accepts the existing distance and angle boundaries', () => {
  assert.equal(isDetected(5, 12, 5, 12), true);
  assert.equal(isDetected(5.01, 12, 5, 12), false);
  assert.equal(isDetected(5, 12.01, 5, 12), false);
});

test('rankCandidates prefers a reachable off-axis surface', () => {
  const ranked = rankCandidates(
    [
      { id: 'front', pos: [0, 0, -2] },
      { id: 'off-axis', pos: [2, 0, 0] },
      { id: 'too-far', pos: [0, 0, -10] },
    ],
    [0, 0, 0],
    [0, 0, -1],
    () => 0,
  );

  assert.equal(ranked[0].candidate.id, 'off-axis');
  assert.equal(ranked[0].distance, 2);
  assert.equal(ranked[0].angle, 90);
});

test('viewer quaternion produces the same forward direction used by WebXR scanning', () => {
  const identity = forwardFromQuaternion([0, 0, 0, 1]);
  assert.ok(Math.abs(identity[0]) < 1e-9);
  assert.ok(Math.abs(identity[1]) < 1e-9);
  assert.equal(identity[2], -1);
  const rotated = forwardFromQuaternion([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  assert.ok(Math.abs(rotated[0] + 1) < 1e-9);
  assert.ok(Math.abs(rotated[1]) < 1e-9);
  assert.ok(Math.abs(rotated[2]) < 1e-9);
});

test('measureTarget reports distance and angle from numeric pose arrays', () => {
  const measurement = measureTarget([0, 0, -2], [0, 0, 0], [0, 0, -1]);
  assert.equal(measurement.distance, 2);
  assert.equal(measurement.angle, 0);
});
