import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VoxelGrid,
  cellCenterPosition,
  cellMeanPosition,
  confirmedCellPositions,
  histogramDisplayCount,
  selectCells,
} from '../src/voxel-grid.js';

test('a repeat hit inside one keyframe accumulates without counting again', () => {
  const grid = new VoxelGrid({ voxelSize: 0.05 });
  assert.equal(grid.observe(0.01, 0.01, 0.01, 1), 'new');
  assert.equal(grid.observe(0.02, 0.01, 0.01, 1), 'accumulated');

  const cell = grid.getCell(0, 0, 0);
  assert.equal(cell.observationCount, 1);
  assert.equal(cell.sampleCount, 2);
});

test('a hit from a different keyframe counts as a new observation', () => {
  const grid = new VoxelGrid({ voxelSize: 0.05 });
  grid.observe(0.01, 0.01, 0.01, 1);
  assert.equal(grid.observe(0.01, 0.01, 0.01, 2), 'observed');
  assert.equal(grid.getCell(0, 0, 0).observationCount, 2);
});

test('the stored position is the mean of the raw points, not the cell center', () => {
  const grid = new VoxelGrid({ voxelSize: 0.05 });
  grid.observe(0.01, 0, 0, 1);
  grid.observe(0.03, 0, 0, 2);

  const cell = grid.getCell(0, 0, 0);
  assert.ok(Math.abs(cellMeanPosition(cell)[0] - 0.02) < 1e-12);
  assert.ok(Math.abs(cellCenterPosition(cell, 0.05)[0] - 0.025) < 1e-12);
});

test('a non-zero origin shifts the grid indices', () => {
  const grid = new VoxelGrid({ voxelSize: 0.1, origin: [1, 0, 0] });
  grid.observe(1.05, 0, 0, 1);
  grid.observe(0.95, 0, 0, 1);
  assert.ok(grid.getCell(0, 0, 0));
  assert.ok(grid.getCell(-1, 0, 0));
});

test('negative coordinates floor downward', () => {
  const grid = new VoxelGrid({ voxelSize: 0.1 });
  grid.observe(-0.01, -0.01, -0.01, 1);
  assert.ok(grid.getCell(-1, -1, -1));
});

test('the histogram buckets 1/2/3/4+ and totals the cell count', () => {
  const grid = new VoxelGrid({ voxelSize: 1 });
  grid.observe(0.5, 0.5, 0.5, 1); // one observation
  for (const f of [1, 2]) grid.observe(1.5, 0.5, 0.5, f); // two
  for (const f of [1, 2, 3]) grid.observe(2.5, 0.5, 0.5, f); // three
  for (const f of [1, 2, 3, 4]) grid.observe(3.5, 0.5, 0.5, f); // four

  const h = grid.getHistogram();
  assert.deepEqual(h, { one: 1, two: 1, three: 1, fourPlus: 1, total: 4 });
  assert.equal(h.total, grid.getCellCount());
});

test('histogramDisplayCount matches the threshold slider', () => {
  const h = { one: 10, two: 5, three: 3, fourPlus: 2, total: 20 };
  assert.equal(histogramDisplayCount(h, 1), 20);
  assert.equal(histogramDisplayCount(h, 2), 10);
  assert.equal(histogramDisplayCount(h, 3), 5);
  assert.equal(histogramDisplayCount(h, 4), 2);
});

test('selectCells drops cells under the threshold and preserves order', () => {
  const cells = [
    { key: 'a', observationCount: 1 },
    { key: 'b', observationCount: 3 },
    { key: 'c', observationCount: 2 },
  ];
  assert.deepEqual(selectCells(cells, { minObservations: 2 }).map((c) => c.key), ['b', 'c']);
  assert.equal(selectCells(cells, { minObservations: 1 }).length, 3);
});

// A full grid that stopped counting would under-report observations and make
// the histogram lie about how well multi-view verification is working.
test('a full grid rejects new cells but keeps counting the existing ones', () => {
  const grid = new VoxelGrid({ voxelSize: 1, maxCells: 1 });
  assert.equal(grid.observe(0.5, 0.5, 0.5, 1), 'new');
  assert.equal(grid.observe(5.5, 0.5, 0.5, 1), 'full');
  assert.equal(grid.isFull(), true);
  assert.equal(grid.observe(0.5, 0.5, 0.5, 2), 'observed');
  assert.equal(grid.getCell(0, 0, 0).observationCount, 2);
});

// lastFrameId replaces the spec's per-cell Set<frameId>. That is only
// equivalent while keyframes are drained strictly in order, which
// rebuildVoxelGrid guarantees. This test pins the precondition.
test('interleaved keyframe ids over-count, documenting the in-order precondition', () => {
  const grid = new VoxelGrid({ voxelSize: 1 });
  grid.observe(0.5, 0.5, 0.5, 1);
  grid.observe(0.5, 0.5, 0.5, 2);
  grid.observe(0.5, 0.5, 0.5, 1);
  assert.equal(grid.getCell(0, 0, 0).observationCount, 3);
});

test('the revision bumps on new cells and on reset, not on accumulation', () => {
  const grid = new VoxelGrid({ voxelSize: 1 });
  const start = grid.getRevision();
  grid.observe(0.5, 0.5, 0.5, 1);
  const afterNew = grid.getRevision();
  assert.ok(afterNew > start);

  grid.observe(0.6, 0.5, 0.5, 1);
  assert.equal(grid.getRevision(), afterNew);

  grid.reset();
  assert.ok(grid.getRevision() > afterNew);
  assert.equal(grid.getCellCount(), 0);
});

test('confirmed cells convert to grid-centre world points', () => {
  const grid = new VoxelGrid({ voxelSize: 0.1 });
  grid.observe(0.05, 0.05, 0.05, 1); // one observation
  for (const f of [1, 2, 3]) grid.observe(0.35, 0.05, 0.05, f); // three

  const points = confirmedCellPositions(grid.getCells(), {
    minObservations: 3,
    voxelSize: 0.1,
  });
  assert.equal(points.length, 1, 'the single-observation cell is not confirmed');
  assert.ok(Math.abs(points[0][0] - 0.35) < 1e-9, 'grid centre, not the raw sample');
});

test('confirmed positions honour a non-zero origin', () => {
  const grid = new VoxelGrid({ voxelSize: 0.1, origin: [1, 0, 0] });
  for (const f of [1, 2, 3]) grid.observe(1.05, 0.05, 0.05, f);
  const points = confirmedCellPositions(grid.getCells(), {
    minObservations: 3, voxelSize: 0.1, origin: [1, 0, 0],
  });
  assert.ok(Math.abs(points[0][0] - 1.05) < 1e-9);
});
