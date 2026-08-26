import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const threeStubUrl = new URL('./support/three-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: threeStubUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { VoxelTerrain } = await import('../src/voxel-terrain.js');

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// With identity projection and view matrices a sample at normalized (u, v)
// unprojects to [(2u-1)*d, (1-2v)*d, -d], so a grid of pixels fans out into
// distinct world points and the number of cells is predictable.
function makeView(depth = 1.5, width = 4, height = 3) {
  return {
    view: { projectionMatrix: IDENTITY, transform: { matrix: IDENTITY } },
    depthInformation: { width, height, getDepthInMeters() { return depth; } },
  };
}

function makeSource(view) {
  return { read() { return { views: [view] }; } };
}

const pose = (x = 0) => ({ position: [x, 0, 0], quaternion: [0, 0, 0, 1] });

// The count-fusion rig: these tests pin the hit-counting contract (cell
// counts, one observation per keyframe) that ?fusion=count keeps. The TSDF
// rig below covers the default path.
function rig({ view = makeView(), minObservations = 3, ...rest } = {}) {
  const solids = [];
  const cleared = [];
  const terrain = new VoxelTerrain({
    depthSource: makeSource(view),
    minObservations,
    minGapMs: 0,
    fusion: 'count',
    onSolid: (c) => solids.push(c),
    onCleared: (c) => cleared.push(c),
    ...rest,
  });
  return { terrain, solids, cleared };
}

test('a keyframe is folded into the grid the moment it lands', () => {
  const { terrain } = rig();
  assert.equal(terrain.update({}, {}, 0, pose(0)), true);
  assert.equal(terrain.getKeyframeCount(), 1);
  assert.equal(terrain.getCellCount(), 12, '4x3 samples at 1.5m spread into 12 cells');
  assert.equal(terrain.getSolidCount(), 0, 'one viewpoint confirms nothing');
});

test('the pose gate rejects frames without enough motion', () => {
  const { terrain } = rig();
  terrain.update({}, {}, 0, pose(0));
  assert.equal(terrain.update({}, {}, 100, pose(0.01)), false);
  assert.equal(terrain.getKeyframeCount(), 1);
});

// The defect VoxelMap has: several samples of one frame in one cell count as
// several observations. Here a 40x30 grid at 0.5m puts ~2 samples per 5cm
// cell, yet no cell may exceed one observation after a single keyframe.
test('samples of one keyframe count as one observation per cell', () => {
  const { terrain } = rig({ view: makeView(0.5, 40, 30) });
  terrain.update({}, {}, 0, pose(0));
  const cells = terrain.grid.getCells();
  assert.ok(cells.length < 1200, 'several samples share a cell');
  assert.ok(cells.every((c) => c.observationCount === 1));
  assert.ok(cells.some((c) => c.sampleCount > 1));
  assert.equal(terrain.getSolidCount(), 0);
});

test('a cell is handed to onSolid exactly once, on its Nth distinct viewpoint', () => {
  const { terrain, solids } = rig();
  // Identity matrices ignore the pose, so every keyframe sees the same points
  // while the gate still accepts each as a new viewpoint.
  terrain.update({}, {}, 0, pose(0));
  terrain.update({}, {}, 1, pose(1));
  assert.equal(solids.length, 0);
  assert.equal(terrain.getRevision(), 0);

  terrain.update({}, {}, 2, pose(2));
  assert.equal(solids.length, 12);
  assert.equal(terrain.getSolidCount(), 12);
  assert.ok(terrain.getRevision() > 0);

  const revision = terrain.getRevision();
  terrain.update({}, {}, 3, pose(3));
  assert.equal(solids.length, 12, 'a fourth look must not re-confirm');
  assert.equal(terrain.getRevision(), revision);
});

test('solid voxels carry the VoxelMap shape the operator view draws', () => {
  const { terrain } = rig({ minObservations: 1 });
  terrain.update({}, {}, 0, pose(0));
  const [voxel] = terrain.getSolidVoxels();
  assert.equal(voxel.position.length, 3);
  assert.ok(voxel.colorT >= 0 && voxel.colorT <= 1);
  // Cell centres sit half a voxel off the 5cm lattice.
  for (const c of voxel.position) {
    const frac = Math.abs((c / 0.05) % 1);
    assert.ok(Math.abs(frac - 0.5) < 1e-6, `${c} is not a cell centre`);
  }
});

test('the solid list stops at maxSolid but the chase grid still hears every cell', () => {
  const { terrain, solids } = rig({ minObservations: 1, maxSolid: 5 });
  terrain.update({}, {}, 0, pose(0));
  assert.equal(terrain.getSolidCount(), 5);
  assert.equal(solids.length, 12);
});

test('a full grid sheds single-look cells instead of freezing', () => {
  const { terrain } = rig({ view: makeView(1.5, 4, 3), maxCells: 12, evictBatch: 4 });
  terrain.update({}, {}, 0, pose(0));
  assert.equal(terrain.getCellCount(), 12);
  // A farther view lands on 12 new cells; the grid is full, so each new cell
  // costs an eviction of an unconfirmed one.
  terrain.capture.depthSource = makeSource(makeView(3.0, 4, 3));
  terrain.update({}, {}, 1, pose(1));
  assert.ok(terrain.getStats().evicted > 0);
  assert.ok(terrain.getCellCount() <= 12);
});

test('reset clears everything and bumps the revision', () => {
  const { terrain } = rig({ minObservations: 1 });
  terrain.update({}, {}, 0, pose(0));
  const revision = terrain.getRevision();
  terrain.reset();
  assert.equal(terrain.getSolidCount(), 0);
  assert.equal(terrain.getCellCount(), 0);
  assert.equal(terrain.getKeyframeCount(), 0);
  assert.ok(terrain.getRevision() > revision);
  assert.equal(terrain.update({}, {}, 5, pose(0)), true, 'the gate baseline was cleared');
});

test('exportJSON carries every cell with its observation count and the trail', async () => {
  const { voxelCellsFromJSON } = await import('../src/voxel-cells-codec.js');
  const { terrain } = rig();
  terrain.update({}, {}, 0, pose(0));
  terrain.update({}, {}, 1, pose(1));
  const json = JSON.parse(terrain.exportJSON({ playerPath: [[0, 0, 0]], sessionId: 's1' }));
  assert.equal(json.kind, 'voxel-cells');
  assert.equal(json.source, 'keyframe');
  assert.equal(json.keyframeCount, 2);
  assert.equal(json.cells.length, 12);
  const back = voxelCellsFromJSON(json);
  assert.ok(back.grid.getCells().every((c) => c.observationCount === 2));
  assert.deepEqual(back.meta.playerPath, [[0, 0, 0]]);
});

// ── TSDF fusion (the default) ────────────────────────────────
// The identity-matrix rig puts the camera at the origin looking down -Z, so a
// keyframe at depth d is a wall at z = -d seen head-on.
function tsdfRig({ view = makeView(1.5, 8, 6), minObservations = 3, ...rest } = {}) {
  const solids = [];
  const cleared = [];
  const terrain = new VoxelTerrain({
    depthSource: makeSource(view),
    minObservations,
    minGapMs: 0,
    onSolid: (c) => solids.push(c),
    onCleared: (c) => cleared.push(c),
    ...rest,
  });
  return { terrain, solids, cleared };
}

test('tsdf is the default fusion and a wall becomes solid after minObservations frames', () => {
  const { terrain, solids } = tsdfRig();
  assert.equal(terrain.fusion, 'tsdf');
  terrain.update({}, {}, 0, pose(0));
  terrain.update({}, {}, 1, pose(1));
  assert.equal(terrain.getSolidCount(), 0, 'two viewpoints confirm nothing');
  terrain.update({}, {}, 2, pose(2));
  assert.ok(terrain.getSolidCount() > 0);
  assert.equal(solids.length, terrain.getSolidCount());
  // Every solid voxel hugs the wall plane.
  for (const { position } of terrain.getSolidVoxels()) {
    assert.ok(Math.abs(position[2] + 1.5) <= 0.1, `z ${position[2]} is off the wall`);
  }
  assert.ok(terrain.getStats().carved > 0, 'free space in front of the wall was carved');
});

test('tsdf retracts a phantom once the real surface is seen through it', () => {
  const { terrain, cleared } = tsdfRig({ tsdf: { carveStride: 1, carveStartM: 0 } });
  // Three frames of a phantom wall at 0.5m ...
  for (let i = 0; i < 3; i += 1) terrain.update({}, {}, i, pose(i));
  const phantom = terrain.getSolidCount();
  assert.ok(phantom > 0);
  // ... then the real wall at 3m, many times, from the same spot.
  terrain.capture.depthSource = makeSource(makeView(3.0, 8, 6));
  for (let i = 3; i < 30; i += 1) terrain.update({}, {}, i, pose(i));
  assert.ok(cleared.length >= phantom * 0.9, `cleared ${cleared.length} of ${phantom}`);
  assert.equal(terrain.getStats().cleared, cleared.length);
  // The solid list shrank to match, and no entry sits at the phantom depth.
  assert.equal(terrain.getSolidVoxels().filter((v) => Math.abs(v.position[2] + 0.5) < 0.1).length, 0);
  assert.equal(terrain.getSolidVoxels().length, terrain.solidIndex.size);
});

test('tsdf export carries only surface cells, in the shared voxel-cells shape', async () => {
  const { voxelCellsFromJSON } = await import('../src/voxel-cells-codec.js');
  const { terrain } = tsdfRig();
  for (let i = 0; i < 3; i += 1) terrain.update({}, {}, i, pose(i));
  const json = JSON.parse(terrain.exportJSON({ sessionId: 's2' }));
  assert.equal(json.source, 'keyframe');
  assert.ok(json.cells.length > 0);
  assert.ok(json.cells.length < terrain.getCellCount(), 'free-space and inside cells are omitted');
  const back = voxelCellsFromJSON(json);
  assert.ok(back.grid.getCells().every((c) => c.observationCount >= 1));
});

test('tsdf reset drops the solid index with everything else', () => {
  const { terrain } = tsdfRig({ minObservations: 1 });
  terrain.update({}, {}, 0, pose(0));
  assert.ok(terrain.solidIndex.size > 0);
  terrain.reset();
  assert.equal(terrain.solidIndex.size, 0);
  assert.equal(terrain.getSolidCount(), 0);
});
