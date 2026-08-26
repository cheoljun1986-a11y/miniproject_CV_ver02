import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYFRAME_JSON_VERSION,
  KeyframeStore,
  keyframeStoreFromJSON,
  rebuildVoxelGrid,
} from '../src/keyframe-store.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// An identity projection makes the inverse identity too, so depthSampleToWorld
// maps NDC straight through: the ray at (u,v) is [xNdc, yNdc, -1] and scaling it
// by depth/1 puts the point at z = -depth. Same convention as depth-cloud.test.mjs.
function keyframe({ frameId = 1, timeMs = 0, width = 3, height = 3, depth = 2.0, depths } = {}) {
  return {
    frameId,
    timeMs,
    width,
    height,
    depths: depths ?? new Float32Array(width * height).fill(depth),
    projectionMatrix: IDENTITY.slice(),
    invProjectionMatrix: IDENTITY.slice(),
    viewMatrix: IDENTITY.slice(),
    viewerPosition: [0, 0, 0],
    viewerQuaternion: [0, 0, 0, 1],
  };
}

const REBUILD = { voxelSize: 1.0, nearM: 0.3, farM: 5.0, gradientMaxJumpM: 0.10 };

test('the store caps its keyframe count', () => {
  const store = new KeyframeStore({ maxKeyframes: 2 });
  assert.equal(store.add(keyframe({ frameId: 1 })), true);
  assert.equal(store.add(keyframe({ frameId: 2 })), true);
  assert.equal(store.add(keyframe({ frameId: 3 })), false);
  assert.equal(store.getCount(), 2);
});

test('elapsed time spans the first and last keyframe', () => {
  const store = new KeyframeStore({});
  assert.equal(store.getElapsedMs(), 0);
  store.add(keyframe({ frameId: 1, timeMs: 1000 }));
  store.add(keyframe({ frameId: 2, timeMs: 4500 }));
  assert.equal(store.getElapsedMs(), 3500);
});

test('a uniform keyframe unprojects in front of the camera', () => {
  const { grid, stats } = rebuildVoxelGrid([keyframe()], REBUILD);
  assert.equal(stats.accepted, 9);
  assert.ok(stats.cells >= 1);
  for (const cell of grid.getCells()) {
    assert.ok(cell.sumZ / cell.sampleCount < 0);
  }
});

// THE headline assertion: this is what proves the depth-cloud.js defect is gone.
test('per-keyframe dedup counts viewpoints, not pixels', () => {
  const oneFrame = rebuildVoxelGrid([keyframe({ frameId: 7 })], REBUILD);
  for (const cell of oneFrame.grid.getCells()) {
    assert.equal(cell.observationCount, 1, 'nine pixels in one keyframe are one observation');
  }
  assert.equal(
    oneFrame.grid.getCells().reduce((n, c) => n + c.sampleCount, 0),
    9,
  );

  const twoFrames = rebuildVoxelGrid(
    [keyframe({ frameId: 1 }), keyframe({ frameId: 2 })],
    REBUILD,
  );
  for (const cell of twoFrames.grid.getCells()) {
    assert.equal(cell.observationCount, 2, 'the same cell seen twice counts twice');
  }
});

test('near clipping rejects every sample and leaves no cells', () => {
  const { grid, stats } = rebuildVoxelGrid([keyframe({ depth: 0.1 })], REBUILD);
  assert.equal(stats.rejectedRange, stats.samplesTotal);
  assert.equal(stats.cells, 0);
  assert.equal(grid.getCellCount(), 0);
});

test('gradient rejects are counted apart from range rejects and sum to the total', () => {
  const depths = new Float32Array([
    1.0, 1.0, 1.0,
    1.0, 3.0, 1.0,
    1.0, 1.0, 1.0,
  ]);
  const { stats } = rebuildVoxelGrid([keyframe({ depths })], REBUILD);
  assert.ok(stats.rejectedGradient > 0);
  assert.equal(
    stats.rejectedZero + stats.rejectedRange + stats.rejectedGradient
      + stats.rejectedUnproject + stats.accepted,
    stats.samplesTotal,
  );
});

test('hitting the cell cap is reported, never silent', () => {
  const depths = new Float32Array([1.0, 2.0, 3.0, 1.5, 2.5, 3.5, 1.2, 2.2, 3.2]);
  const { stats } = rebuildVoxelGrid([keyframe({ depths })], {
    ...REBUILD,
    gradientMaxJumpM: 0,
    voxelSize: 0.05,
    maxCells: 2,
  });
  assert.equal(stats.truncated, true);
});

test('a smaller voxel yields strictly more cells from the same keyframes', () => {
  // 50 columns of identity-projected NDC at 1m puts samples 4cm apart, which a
  // 5cm voxel merges in places and a 3cm voxel never does.
  const keyframes = [keyframe({ width: 50, height: 50, depth: 1.0 })];
  const coarse = rebuildVoxelGrid(keyframes, { ...REBUILD, voxelSize: 0.05 });
  const fine = rebuildVoxelGrid(keyframes, { ...REBUILD, voxelSize: 0.03 });
  assert.ok(fine.stats.cells > coarse.stats.cells);
});

test('JSON survives a round trip', () => {
  const store = new KeyframeStore({});
  store.add(keyframe({ frameId: 1, timeMs: 0, depth: 1.2345 }));
  store.add(keyframe({ frameId: 2, timeMs: 900, depth: 1.4 }));

  const restored = keyframeStoreFromJSON(JSON.parse(JSON.stringify(store.toJSON())));
  assert.ok(restored);
  assert.equal(restored.getCount(), 2);

  const before = rebuildVoxelGrid(store.getKeyframes(), REBUILD);
  const after = rebuildVoxelGrid(restored.getKeyframes(), REBUILD);
  assert.deepEqual(after.grid.getHistogram(), before.grid.getHistogram());
  assert.equal(after.grid.getCellCount(), before.grid.getCellCount());
  assert.ok(Math.abs(restored.getKeyframes()[0].depths[0] - 1.2345) <= 1e-3);
});

test('malformed JSON payloads are refused', () => {
  const store = new KeyframeStore({});
  store.add(keyframe());

  const wrongVersion = store.toJSON();
  wrongVersion.version = KEYFRAME_JSON_VERSION + 1;
  assert.equal(keyframeStoreFromJSON(wrongVersion), null);

  const badLength = store.toJSON();
  badLength.keyframes[0].depths = [1, 2];
  assert.equal(keyframeStoreFromJSON(badLength), null);
  assert.equal(keyframeStoreFromJSON(null), null);
});
