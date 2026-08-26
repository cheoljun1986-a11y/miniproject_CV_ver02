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

function rig({ view = makeView(), minObservations = 3, ...rest } = {}) {
  const solids = [];
  const terrain = new VoxelTerrain({
    depthSource: makeSource(view),
    minObservations,
    minGapMs: 0,
    onSolid: (c) => solids.push(c),
    ...rest,
  });
  return { terrain, solids };
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
