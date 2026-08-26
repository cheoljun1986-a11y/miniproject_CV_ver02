import test from 'node:test';
import assert from 'node:assert/strict';

import { multiplyMat4Vec4 } from '../src/depth-math.js';
import { bodySampleOffsets } from '../src/line-of-sight.js';
import {
  invertRigidMat4, liveVisibleFraction, measuredVisibleFraction, projectToView,
} from '../src/live-visibility.js';

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// Symmetric 90° perspective, aspect 1 — column-major like XRView carries it.
function perspective(near = 0.1, far = 100) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -(far + near) / (far - near), -1,
    0, 0, (-2 * far * near) / (far - near), 0,
  ];
}

// Camera at the origin looking down -Z: view->world is the identity, so the
// inverse is too, and every expected value can be worked out by hand.
const CAMERA = [0, 0, 0];
const TARGET = [0, 0, -2];

// ── projection ───────────────────────────────────────────────
test('a point straight ahead lands in the centre of the view', () => {
  const projected = projectToView(TARGET, IDENTITY, perspective());
  assert.ok(projected);
  assert.ok(Math.abs(projected.u - 0.5) < 1e-9);
  assert.ok(Math.abs(projected.v - 0.5) < 1e-9);
  assert.ok(Math.abs(projected.depthM - 2) < 1e-9);
});

test('points behind the camera or outside the frustum are unmeasurable, not blocked', () => {
  assert.equal(projectToView([0, 0, 2], IDENTITY, perspective()), null);
  // 90° fov at 2m spans ±2m; 5m to the side is well outside.
  assert.equal(projectToView([5, 0, -2], IDENTITY, perspective()), null);
});

test('projectToView is the inverse convention of getDepthInMeters sampling', () => {
  // Above the axis must map to the TOP of the view (v < 0.5): view coords are
  // top-left origin, the same convention depthSampleToWorld documents.
  const above = projectToView([0, 1, -2], IDENTITY, perspective());
  assert.ok(above.v < 0.5);
  const right = projectToView([1, 0, -2], IDENTITY, perspective());
  assert.ok(right.u > 0.5);
});

// ── rigid inverse ────────────────────────────────────────────
test('invertRigidMat4 undoes a rotation-plus-translation exactly', () => {
  const angle = 0.7;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Rotation about Y, translated — the shape of an XR view transform.
  const m = [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    1.2, -0.4, 3.1, 1,
  ];
  const inv = invertRigidMat4(m);
  const p = [0.3, 1.7, -2.2, 1];
  const roundTrip = multiplyMat4Vec4(inv, multiplyMat4Vec4(m, p));
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs(roundTrip[i] - p[i]) < 1e-12, `component ${i} drifted`);
  }
});

// ── the measurement itself ───────────────────────────────────
function measure(readDepth, options = {}) {
  return measuredVisibleFraction(
    { readDepth, invViewMatrix: IDENTITY, projectionMatrix: perspective() },
    CAMERA,
    TARGET,
    options,
  );
}

test('a wall well behind the target hides nothing', () => {
  assert.equal(measure(() => 5), 1);
});

test('a wall well in front of the target hides everything', () => {
  assert.equal(measure(() => 1), 0);
});

test('depth noise inside the clearance band does not count as cover', () => {
  // 1.9m reads "closer" than the 2m body, but by less than the 25cm clearance
  // — that is sensor error at range, not furniture.
  assert.equal(measure(() => 1.9), 1);
});

test('missing depth never blocks — same benefit of the doubt as unscanned map', () => {
  assert.equal(measure(() => null), 1);
  assert.equal(measure(() => 0), 1);
});

test('partial cover lands strictly between hidden and clear', () => {
  // Block only the head sample: it is the one clearly above centre, so it
  // projects to the top band of the view (v < 0.47) while every other sample
  // stays below. One of seven blocked -> 6/7.
  const fraction = measure((u, v) => (v < 0.47 ? 1 : 5));
  assert.ok(Math.abs(fraction - 6 / 7) < 1e-9);
});

test('a target fully off screen measures null, not zero', () => {
  const fraction = measuredVisibleFraction(
    { readDepth: () => 1, invViewMatrix: IDENTITY, projectionMatrix: perspective() },
    CAMERA,
    [50, 0, -2],
  );
  assert.equal(fraction, null);
});

// ── snapshot adapter ─────────────────────────────────────────
function snapshotWith(getDepthInMeters) {
  return {
    views: [{
      view: { transform: { matrix: IDENTITY }, projectionMatrix: perspective() },
      depthInformation: { getDepthInMeters },
    }],
  };
}

test('the adapter runs the measurement against a depth snapshot view', () => {
  assert.equal(liveVisibleFraction(snapshotWith(() => 5), CAMERA, TARGET), 1);
  assert.equal(liveVisibleFraction(snapshotWith(() => 1), CAMERA, TARGET), 0);
});

test('no snapshot, no views, or a throwing runtime all degrade to "unknown or clear"', () => {
  assert.equal(liveVisibleFraction(null, CAMERA, TARGET), null);
  assert.equal(liveVisibleFraction({ views: [] }, CAMERA, TARGET), null);
  // A runtime rejecting samples is missing data, and missing data never blocks.
  const throwing = snapshotWith(() => { throw new Error('outside valid region'); });
  assert.equal(liveVisibleFraction(throwing, CAMERA, TARGET), 1);
});

// ── the shared silhouette ────────────────────────────────────
test('both visibility tests sample the same seven-point silhouette', () => {
  const offsets = bodySampleOffsets(CAMERA, TARGET);
  assert.equal(offsets.length, 7);
  // Looking down -Z the flanks must spread along ±X — the silhouette the
  // camera actually faces, not the depth axis it cannot see across.
  assert.ok(Math.abs(offsets[3][0] - 0.10) < 1e-9);
  assert.ok(Math.abs(offsets[4][0] + 0.10) < 1e-9);
});
