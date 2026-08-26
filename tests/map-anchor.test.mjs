import test from 'node:test';
import assert from 'node:assert/strict';

import { MapAnchor } from '../src/map-anchor.js';

const LOCAL = { kind: 'local-space' };

function poseFrame({ position = { x: 0, y: 0, z: 0 }, orientation = { x: 0, y: 0, z: 0, w: 1 } } = {}) {
  return {
    createAnchor: () => ({ anchorSpace: { kind: 'anchor-space' } }),
    getPose: () => ({ transform: { position, orientation } }),
  };
}

async function tracked(frame) {
  const anchor = new MapAnchor();
  anchor.beginTracking();
  anchor.update(frame, LOCAL, (p) => p);
  await Promise.resolve(); // anchor creation resolves
  anchor.update(frame, LOCAL, (p) => p);
  return anchor;
}

test('with no anchor both conversions are the identity', () => {
  const anchor = new MapAnchor();
  assert.deepEqual(anchor.toWorld([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(anchor.toAnchor([1, 2, 3]), [1, 2, 3]);
  assert.equal(anchor.yaw(), 0);
});

test('a drift correction that moved the origin carries the map with it', async () => {
  // The platform now says the nail sits 0.3m to the right of where the origin
  // frame thinks it is.
  const anchor = await tracked(poseFrame({ position: { x: 0.3, y: 0, z: 0 } }));
  assert.equal(anchor.getState(), 'anchor');
  assert.deepEqual(anchor.toWorld([1, 0, 0]), [1.3, 0, 0]);
  // And a live world point converts back into map coordinates.
  const [ax] = anchor.toAnchor([1.3, 0, 0]);
  assert.ok(Math.abs(ax - 1) < 1e-12);
});

test('toAnchor and toWorld are exact inverses under rotation too', async () => {
  // 90 degrees about Y.
  const s = Math.sin(Math.PI / 4);
  const anchor = await tracked(poseFrame({
    position: { x: 0.5, y: -0.2, z: 1.0 },
    orientation: { x: 0, y: s, z: 0, w: s },
  }));
  const p = [1.2, 0.4, -0.7];
  const round = anchor.toAnchor(anchor.toWorld(p));
  for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(round[i] - p[i]) < 1e-9);
  // yaw of a 90-degree Y rotation
  assert.ok(Math.abs(Math.abs(anchor.yaw()) - Math.PI / 2) < 1e-6);
});

test('anchors unsupported falls back to identity, not a crash', () => {
  const anchor = new MapAnchor();
  anchor.beginTracking();
  anchor.update({ /* no createAnchor */ }, LOCAL, (p) => p);
  assert.equal(anchor.getState(), 'local');
  assert.deepEqual(anchor.toWorld([1, 2, 3]), [1, 2, 3]);
});

test('losing the pose keeps the last known transform instead of snapping back', async () => {
  const frame = poseFrame({ position: { x: 0.3, y: 0, z: 0 } });
  const anchor = await tracked(frame);
  // Tracking drops: getPose returns nothing for a while.
  anchor.update({ createAnchor: frame.createAnchor, getPose: () => null }, LOCAL, (p) => p);
  assert.equal(anchor.getState(), 'anchor-lost');
  assert.deepEqual(anchor.toWorld([0, 0, 0]), [0.3, 0, 0]);
  // It comes back.
  anchor.update(frame, LOCAL, (p) => p);
  assert.equal(anchor.getState(), 'anchor');
});

test('reset returns it to identity for the next map build', async () => {
  const anchor = await tracked(poseFrame({ position: { x: 5, y: 0, z: 0 } }));
  anchor.reset();
  assert.equal(anchor.getState(), 'idle');
  assert.deepEqual(anchor.toWorld([1, 1, 1]), [1, 1, 1]);
});
