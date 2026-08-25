import test from 'node:test';
import assert from 'node:assert/strict';

import { NinjaGame } from '../src/ninja-game.js';
import { SpatialMapper } from '../src/spatial-mapper.js';

const LOCAL_SPACE = { kind: 'local-space' };
const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function matrixAt(x, y, z) {
  const matrix = IDENTITY_MATRIX.slice();
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

function createHarness() {
  const statuses = [];
  const controls = [];
  const sceneObjects = [];
  const ui = {
    setStatus(value) { statuses.push(value); },
    setMessage() {},
    setControls(value) { controls.push(value); },
    flash() {},
  };
  const scene = {
    add(object) { sceneObjects.push(object); },
    remove(object) {
      const index = sceneObjects.indexOf(object);
      if (index >= 0) sceneObjects.splice(index, 1);
    },
  };
  const model = {
    createNinja() {
      return {
        matrixAutoUpdate: true,
        matrixWorldNeedsUpdate: false,
        matrix: {
          values: null,
          fromArray(values) { this.values = Array.from(values); },
        },
        position: {
          x: 0,
          y: 0,
          z: 0,
          set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
          },
        },
        quaternion: { identity() {} },
      };
    },
    revealNinja(object) { object.revealed = true; },
    disposeObject(object) { object.disposed = true; },
    createSurfaceMarker(position, horizontal) {
      return { marker: true, position, horizontal };
    },
  };
  const mapper = new SpatialMapper({ minCandidateSpacing: 0.22 });
  const pose = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
  };
  const game = new NinjaGame({
    scene,
    ui,
    mapper,
    model,
    getSession: () => ({}),
    getLocalSpace: () => LOCAL_SPACE,
    getViewerPose: () => pose,
    makeRigidTransform: (position) => ({ position }),
    now: () => 1000,
    random: () => 0,
  });

  return { game, mapper, statuses, controls, sceneObjects };
}

function addHorizontalCandidate(mapper, position = [0, 0, -2]) {
  mapper.recordSurface({
    position,
    upY: 1,
    matrix: matrixAt(...position),
  });
}

function deferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test('session start enters mapping with the existing control availability', () => {
  const { game, controls } = createHarness();
  game.startSession();

  assert.equal(game.getState().phase, 'mapping');
  assert.deepEqual(controls.at(-1), {
    scan: false,
    newRound: false,
    extend: true,
    mark: true,
    check: true,
  });
});

test('mapping candidates produce a hidden target that can be detected', () => {
  const { game, mapper, sceneObjects } = createHarness();
  game.startSession();
  for (const [index, position] of [[0, 0, -2], [0.3, 0, -2], [0.6, 0, -2]].entries()) {
    mapper.recordSurface({ position, matrix: [index], upY: 1 });
  }

  game.finishMapping();
  assert.equal(game.getState().phase, 'hunt');
  assert.equal(sceneObjects.length, 1);

  assert.equal(game.triggerScan(), true);
  assert.equal(game.getState().phase, 'found');
  assert.equal(sceneObjects[0].revealed, true);
});

test('mapping drops a visible marker for each stored scan point and clears them on a new scan', () => {
  const { game, sceneObjects } = createHarness();
  game.startSession();

  // Two points far enough apart to both be stored (spacing rule is 0.22m).
  game.update(1000, {}, { position: [0, 0, -2], upY: 1, matrix: [0] });
  game.update(2000, {}, { position: [1, 0, -2], upY: 0, matrix: [1] });

  const markers = sceneObjects.filter((object) => object.marker);
  assert.equal(markers.length, 2);
  assert.equal(markers[0].horizontal, true); // upY 1 > threshold
  assert.equal(markers[1].horizontal, false); // upY 0 < threshold

  // A fresh scan (reset) removes the previous markers from the scene.
  game.startMapping(20, true);
  assert.equal(sceneObjects.filter((object) => object.marker).length, 0);
});

test('getTargetPosition returns the hidden position while hunting and null otherwise', () => {
  const { game, mapper } = createHarness();
  assert.equal(game.getTargetPosition(), null);
  game.startSession();
  for (const [index, position] of [[0, 0, -2], [0.3, 0, -2], [0.6, 0, -2]].entries()) {
    mapper.recordSurface({ position, matrix: [index], upY: 1 });
  }
  game.finishMapping();
  const target = game.getTargetPosition();
  assert.ok(Array.isArray(target) && target.length === 3);
  game.endSession();
  assert.equal(game.getTargetPosition(), null);
});

test('uses the same surface-offset position for rendering and detection', () => {
  const { game, mapper, sceneObjects } = createHarness();
  game.startSession();
  mapper.recordSurface({
    position: [0, 0, -2],
    upY: 1,
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -2, 1,
    ],
  });

  assert.equal(game.hideNewTarget(), true);
  const rendered = sceneObjects.at(-1).position;
  assert.deepEqual(game.getTargetPosition(), [rendered.x, rendered.y, rendered.z]);
  assert.deepEqual(game.getTargetPosition(), [0, 0.02, -2]);
});

test('creates an anchor from the final local pose on the next active XR frame', async () => {
  const { game, mapper, sceneObjects } = createHarness();
  addHorizontalCandidate(mapper);
  game.hideNewTarget();
  assert.equal(game.getAnchorState(), 'anchor-pending');

  const anchor = { anchorSpace: {} };
  let createCalls = 0;
  const frame = {
    createAnchor(transform, space) {
      createCalls += 1;
      assert.deepEqual(transform.position, { x: 0, y: 0.02, z: -2 });
      assert.equal(space, LOCAL_SPACE);
      return Promise.resolve(anchor);
    },
    getPose(space, referenceSpace) {
      assert.equal(space, anchor.anchorSpace);
      assert.equal(referenceSpace, LOCAL_SPACE);
      return { transform: { matrix: matrixAt(1, 2, 3) } };
    },
  };

  game.update(1001, frame, null);
  await flushPromises();
  game.update(1002, frame, null);

  assert.equal(createCalls, 1);
  assert.equal(game.getAnchorState(), 'anchor');
  assert.deepEqual(game.getTargetPosition(), [1, 2, 3]);
  assert.equal(sceneObjects[0].matrixAutoUpdate, false);
  assert.deepEqual(sceneObjects[0].matrix.values, matrixAt(1, 2, 3));
  assert.equal(sceneObjects[0].matrixWorldNeedsUpdate, true);
});

test('falls back to local placement when XRFrame anchor creation is unavailable', () => {
  const { game, mapper } = createHarness();
  addHorizontalCandidate(mapper);
  game.hideNewTarget();

  game.update(1001, {}, null);

  assert.equal(game.getAnchorState(), 'local');
  assert.deepEqual(game.getTargetPosition(), [0, 0.02, -2]);
});

test('falls back to local placement when anchor creation rejects', async () => {
  const { game, mapper } = createHarness();
  addHorizontalCandidate(mapper);
  game.hideNewTarget();

  game.update(1001, {
    createAnchor: () => Promise.reject(new Error('anchors rejected')),
  }, null);
  await flushPromises();

  assert.equal(game.getAnchorState(), 'local');
  assert.deepEqual(game.getTargetPosition(), [0, 0.02, -2]);
});

test('keeps the last anchor pose during temporary tracking loss and recovers', async () => {
  const { game, mapper } = createHarness();
  addHorizontalCandidate(mapper);
  game.hideNewTarget();
  const anchor = { anchorSpace: {} };
  const poses = [
    { transform: { matrix: matrixAt(1, 2, 3) } },
    null,
    { transform: { matrix: matrixAt(4, 5, 6) } },
  ];
  const frame = {
    createAnchor: () => Promise.resolve(anchor),
    getPose: () => poses.shift(),
  };

  game.update(1001, frame, null);
  await flushPromises();
  game.update(1002, frame, null);
  assert.equal(game.getAnchorState(), 'anchor');
  assert.deepEqual(game.getTargetPosition(), [1, 2, 3]);

  game.update(1003, frame, null);
  assert.equal(game.getAnchorState(), 'anchor-lost');
  assert.deepEqual(game.getTargetPosition(), [1, 2, 3]);

  game.update(1004, frame, null);
  assert.equal(game.getAnchorState(), 'anchor');
  assert.deepEqual(game.getTargetPosition(), [4, 5, 6]);
});

test('deletes an anchor that resolves after its target was cleared', async () => {
  const { game, mapper } = createHarness();
  addHorizontalCandidate(mapper);
  game.hideNewTarget();
  const deferred = deferredPromise();
  const staleAnchor = {
    anchorSpace: {},
    deleted: false,
    delete() { this.deleted = true; },
  };

  game.update(1001, { createAnchor: () => deferred.promise }, null);
  game.clearTarget();
  deferred.resolve(staleAnchor);
  await flushPromises();

  assert.equal(staleAnchor.deleted, true);
  assert.equal(game.getTargetPosition(), null);
});

test('deletes the current anchor when the session ends', async () => {
  const { game, mapper } = createHarness();
  addHorizontalCandidate(mapper);
  game.hideNewTarget();
  const anchor = {
    anchorSpace: {},
    deleted: false,
    delete() { this.deleted = true; },
  };
  const frame = {
    createAnchor: () => Promise.resolve(anchor),
    getPose: () => ({ transform: { matrix: matrixAt(1, 2, 3) } }),
  };
  game.update(1001, frame, null);
  await flushPromises();
  game.update(1002, frame, null);

  game.endSession();

  assert.equal(anchor.deleted, true);
  assert.equal(game.getAnchorState(), null);
});
