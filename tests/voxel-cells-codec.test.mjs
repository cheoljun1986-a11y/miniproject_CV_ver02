import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cellsFromSolidVoxels,
  isVoxelCellsJSON,
  voxelCellsFromJSON,
  voxelCellsToJSON,
} from '../src/voxel-cells-codec.js';
import { VoxelGrid, cellMeanPosition } from '../src/voxel-grid.js';

function sampleGrid() {
  const grid = new VoxelGrid({ voxelSize: 0.05 });
  grid.observe(0.01, 0.02, 0.03, 1);
  grid.observe(0.02, 0.02, 0.03, 1); // same cell, same frame
  grid.observe(0.01, 0.02, 0.03, 2);
  grid.observe(0.01, 0.02, 0.03, 3);
  grid.observe(1.01, -1.4, 0.5, 1);
  return grid;
}

test('a grid round-trips through JSON with counts, means and voxel size intact', () => {
  const grid = sampleGrid();
  const json = voxelCellsToJSON({
    cells: grid.getCells(),
    voxelSize: 0.05,
    keyframeCount: 3,
    sessionId: '20260826-101500',
    playerPath: [[0, 0, 0], [0.15, 0, 0.001]],
  });
  assert.equal(isVoxelCellsJSON(json), true);
  assert.equal(json.cells.length, 2);

  const back = voxelCellsFromJSON(JSON.parse(JSON.stringify(json)));
  assert.ok(back);
  assert.equal(back.grid.voxelSize, 0.05);
  assert.equal(back.grid.getCellCount(), 2);
  assert.equal(back.meta.sessionId, '20260826-101500');
  assert.equal(back.meta.keyframeCount, 3);
  assert.deepEqual(back.meta.playerPath, [[0, 0, 0], [0.15, 0, 0.001]]);

  const original = grid.getCell(0, 0, 0);
  const restored = back.grid.getCell(0, 0, 0);
  assert.equal(restored.observationCount, 3);
  const [ox, oy, oz] = cellMeanPosition(original);
  const [rx, ry, rz] = cellMeanPosition(restored);
  assert.ok(Math.abs(ox - rx) < 1e-3 && Math.abs(oy - ry) < 1e-3 && Math.abs(oz - rz) < 1e-3);
  assert.deepEqual(back.grid.getHistogram(), grid.getHistogram());
});

test('VoxelMap solid voxels widen to the same cell shape', () => {
  const cells = cellsFromSolidVoxels([{ position: [0.025, -1.375, 0.525], colorT: 0 }], 0.05, 3);
  assert.equal(cells.length, 1);
  assert.deepEqual([cells[0].ix, cells[0].iy, cells[0].iz], [0, -28, 10]);
  assert.equal(cells[0].observationCount, 3);
  assert.deepEqual(cellMeanPosition(cells[0]), [0.025, -1.375, 0.525]);
});

test('keyframe scan JSON and garbage are rejected', () => {
  assert.equal(voxelCellsFromJSON({ version: 1, keyframes: [] }), null, 'the other format');
  assert.equal(voxelCellsFromJSON(null), null);
  assert.equal(voxelCellsFromJSON({ version: 1, kind: 'voxel-cells', voxelSize: 0, cells: [] }), null);
  assert.equal(voxelCellsFromJSON({ version: 1, kind: 'voxel-cells', voxelSize: 0.05, cells: [[1, 2]] }), null);
});
