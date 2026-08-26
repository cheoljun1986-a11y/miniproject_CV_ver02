import test from 'node:test';
import assert from 'node:assert/strict';

import { KeyframeGate, isKeyframe, quaternionAngleDeg } from '../src/keyframe-gate.js';

const IDENTITY = [0, 0, 0, 1];
// 90 degrees about Y: [0, sin(45), 0, cos(45)]
const YAW_90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const HALF = Math.PI / 180 / 2;
const yaw = (deg) => [0, Math.sin(deg * HALF), 0, Math.cos(deg * HALF)];

test('quaternion angle is sign-agnostic and matches known rotations', () => {
  assert.equal(quaternionAngleDeg(IDENTITY, IDENTITY), 0);
  assert.ok(Math.abs(quaternionAngleDeg(IDENTITY, YAW_90) - 90) < 1e-9);
  // q and -q are the same orientation, so the angle must not flip to 270.
  const negated = YAW_90.map((n) => -n);
  assert.ok(Math.abs(quaternionAngleDeg(IDENTITY, negated) - 90) < 1e-9);
});

test('the first pose is always a keyframe', () => {
  assert.equal(isKeyframe({ lastPose: null, position: [0, 0, 0], quaternion: IDENTITY }), true);
});

test('translation threshold is inclusive at 20cm', () => {
  const lastPose = { position: [0, 0, 0], quaternion: IDENTITY };
  assert.equal(isKeyframe({ lastPose, position: [0.20, 0, 0], quaternion: IDENTITY }), true);
  assert.equal(isKeyframe({ lastPose, position: [0.19, 0, 0], quaternion: IDENTITY }), false);
});

test('rotation threshold is inclusive at 15 degrees', () => {
  const lastPose = { position: [0, 0, 0], quaternion: IDENTITY };
  assert.equal(isKeyframe({ lastPose, position: [0, 0, 0], quaternion: yaw(15) }), true);
  assert.equal(isKeyframe({ lastPose, position: [0, 0, 0], quaternion: yaw(14) }), false);
});

test('either condition alone is enough', () => {
  const lastPose = { position: [0, 0, 0], quaternion: IDENTITY };
  assert.equal(isKeyframe({ lastPose, position: [0.25, 0, 0], quaternion: IDENTITY }), true);
  assert.equal(isKeyframe({ lastPose, position: [0, 0, 0], quaternion: yaw(20) }), true);
});

// The cooldown must only ever DELAY a keyframe. If the pose baseline moved to
// the moment the threshold was first crossed, a 200ms poll would silently widen
// the effective rotation threshold to ~18 degrees and make drift undiagnosable.
test('cooldown delays capture without widening the pose delta', () => {
  const gate = new KeyframeGate({ minGapMs: 250 });
  gate.accept([0, 0, 0], IDENTITY, 0);

  assert.equal(gate.shouldCapture([1, 0, 0], IDENTITY, 100), false);
  assert.equal(gate.shouldCapture([1, 0, 0], IDENTITY, 300), true);
  assert.deepEqual(gate.getLastPose().position, [0, 0, 0]);
});

test('the keyframe cap stops further captures', () => {
  const gate = new KeyframeGate({ maxKeyframes: 2, minGapMs: 0 });
  gate.accept([0, 0, 0], IDENTITY, 0);
  gate.accept([1, 0, 0], IDENTITY, 10);
  assert.equal(gate.getCount(), 2);
  assert.equal(gate.shouldCapture([2, 0, 0], IDENTITY, 20), false);
});

test('reset clears the count and the pose baseline', () => {
  const gate = new KeyframeGate({ maxKeyframes: 1, minGapMs: 250 });
  gate.accept([0, 0, 0], IDENTITY, 0);
  assert.equal(gate.shouldCapture([9, 0, 0], IDENTITY, 999), false);
  gate.reset();
  assert.equal(gate.getCount(), 0);
  assert.equal(gate.getLastPose(), null);
  assert.equal(gate.shouldCapture([0, 0, 0], IDENTITY, 0), true);
});
