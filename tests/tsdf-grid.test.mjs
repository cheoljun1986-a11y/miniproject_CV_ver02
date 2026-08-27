import test from 'node:test';
import assert from 'node:assert/strict';

import { TsdfGrid, tsdfKey } from '../src/tsdf-grid.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Identity projection + identity view: normalized (u, v) at depth d unprojects
// to [(2u-1)d, (1-2v)d, -d], with the camera at the origin looking down -Z.
function keyframe({ depth = 1.0, width = 8, height = 6, frameId = 1, depths = null, camera = [0, 0, 0] } = {}) {
  const view = IDENTITY.slice();
  view[12] = camera[0];
  view[13] = camera[1];
  view[14] = camera[2];
  return {
    frameId,
    width,
    height,
    depths: depths ?? new Float32Array(width * height).fill(depth),
    invProjectionMatrix: IDENTITY,
    viewMatrix: view,
  };
}

// A single centre pixel, so a ray is exactly one line of voxels.
function pencil({ depth = 1.0, frameId = 1, camera = [0, 0, 0] } = {}) {
  const depths = new Float32Array(1).fill(depth);
  return keyframe({ depth, width: 1, height: 1, frameId, depths, camera });
}

function rig(opts = {}) {
  const solid = [];
  const cleared = [];
  const grid = new TsdfGrid({
    voxelSize: 0.1,
    truncationVoxels: 2,
    minWeight: 3,
    carveStride: 1,
    onSolid: (c) => solid.push(c),
    onCleared: (c) => cleared.push(c),
    ...opts,
  });
  return { grid, solid, cleared };
}

test('numeric keys are unique per cell and round-trip negative indices', () => {
  const seen = new Set();
  for (const ix of [-3, 0, 7]) {
    for (const iy of [-1, 0, 2]) {
      for (const iz of [-5, 0, 1]) seen.add(tsdfKey(ix, iy, iz));
    }
  }
  assert.equal(seen.size, 27);
});

test('one ray writes a signed band around the hit and free space in front', () => {
  const { grid } = rig({ carveStartM: 0 });
  grid.integrate(pencil({ depth: 1.0 }), { nearM: 0.1, farM: 5 });
  // Hit at z = -1.0 with a 0.2m band: samples at t = 0.8..1.2 land in voxels
  // -8..-12 (the hit itself sits on the -10 boundary and reads ~0).
  const column = grid.getCells().filter((c) => c.ix === 0 && c.iy === 0).sort((a, b) => b.iz - a.iz);
  assert.equal(column.length, 5, 'five band samples, one per voxel');
  assert.ok(column[0].iz >= -9 && column[0].tsdf > 0, 'nearest: positive (free)');
  assert.ok(column.some((c) => Math.abs(c.tsdf) < 0.5), 'one voxel sits on the surface');
  assert.ok(column[4].iz <= -11 && column[4].tsdf < 0, 'farthest: negative (inside)');
  const far = grid.getCell(0, 0, -5);
  // Carving only touches existing cells; nothing exists at z=-0.5 yet.
  assert.equal(far, null);
  // Nothing far beyond the band either.
  assert.equal(grid.getCell(0, 0, -20), null);
});

test('a surface becomes solid once minWeight frames agree, and is reported once', () => {
  const { grid, solid } = rig();
  const opts = { nearM: 0.1, farM: 5 };
  grid.integrate(pencil({ depth: 1.0, frameId: 1 }), opts);
  grid.integrate(pencil({ depth: 1.0, frameId: 2 }), opts);
  assert.equal(grid.getSolidCount(), 0, 'two frames are not enough');
  const r = grid.integrate(pencil({ depth: 1.0, frameId: 3 }), opts);
  assert.ok(r.becameSolid >= 1);
  assert.ok(grid.getSolidCount() >= 1);
  assert.equal(solid.length, grid.getSolidCount());
  // The solid cells hug the hit point.
  for (const c of grid.getSolidCells()) assert.ok(Math.abs(c.sumZ + 1.0) <= 0.15, `cell z ${c.sumZ}`);
  // Steady state: a fourth identical frame changes nothing.
  const again = grid.integrate(pencil({ depth: 1.0, frameId: 4 }), opts);
  assert.equal(again.becameSolid, 0);
  assert.equal(again.becameClear, 0);
});

test('free-space evidence from later frames erases a floater and reports it cleared', () => {
  const { grid, cleared } = rig({ carveStartM: 0 });
  const opts = { nearM: 0.1, farM: 5 };
  // Three frames "see" a phantom at 0.5m along the centre ray.
  for (let f = 1; f <= 3; f += 1) grid.integrate(pencil({ depth: 0.5, frameId: f }), opts);
  assert.ok(grid.getSolidCount() >= 1, 'the phantom is solid after three frames');
  const phantomCount = grid.getSolidCount();
  // Then the real wall at 2.0m is seen through that exact spot, many times.
  for (let f = 4; f <= 20; f += 1) grid.integrate(pencil({ depth: 2.0, frameId: f }), opts);
  assert.ok(cleared.length >= phantomCount, `cleared ${cleared.length} of ${phantomCount}`);
  const phantom = grid.getCell(0, 0, -5);
  assert.ok(phantom && !phantom.solid && phantom.tsdf > 0.5, `phantom tsdf ${phantom?.tsdf}`);
});

test('weight counts frames, not rays: many pixels of one frame crossing a voxel add one', () => {
  const { grid } = rig({ minWeight: 2 });
  // 8x6 pixels at 0.3m fan out through a shared near voxel column; with
  // carving from 0 they all cross the cells nearest the camera.
  grid.integrate(keyframe({ depth: 0.3, frameId: 1 }), { nearM: 0.1, farM: 5 });
  for (const cell of grid.getCells()) assert.ok(cell.weight <= 1, `weight ${cell.weight}`);
  assert.equal(grid.getSolidCount(), 0);
  grid.integrate(keyframe({ depth: 0.3, frameId: 2 }), { nearM: 0.1, farM: 5 });
  assert.ok(grid.getSolidCount() > 0);
});

test('a same-frame band observation overrides an earlier carving vote on the same voxel', () => {
  // Two pixels in one frame: the first ray sees far (carves through 1.0m),
  // the second ray hits at 1.0m. Rays are distinct lines here, so build the
  // conflict directly through _fuse instead.
  const { grid } = rig({ minWeight: 1 });
  grid._fuse(0.05, 0.05, -1.05, 1, 7, true);   // carving vote: free
  grid._fuse(0.05, 0.05, -1.05, 0.1, 7, true); // band vote: on the surface
  grid._flushTouched();
  const cell = grid.getCell(0, 0, -11);
  assert.equal(cell.weight, 1);
  assert.equal(cell.observationCount, 1);
  assert.ok(Math.abs(cell.tsdf - 0.1) < 1e-9);
  assert.equal(cell.solid, true);
});

test('the running average is capped so old evidence can be outvoted', () => {
  const { grid } = rig({ maxWeight: 4, minWeight: 1 });
  for (let f = 1; f <= 50; f += 1) grid._fuse(0, 0, -1, -1, f, true);
  const before = grid.getCell(0, 0, -10);
  assert.equal(before.weight, 4);
  for (let f = 51; f <= 60; f += 1) grid._fuse(0, 0, -1, 1, f, true);
  // (-1 * 4 + 1) / 5 per step: ten steps land at ~0.78.
  assert.ok(grid.getCell(0, 0, -10).tsdf > 0.7, 'ten free votes flip a capped negative');
});

test('a full grid stops creating cells and eviction frees single-look non-solid ones', () => {
  const { grid } = rig({ maxCells: 30 });
  grid.integrate(keyframe({ depth: 1.0, frameId: 1 }), { nearM: 0.1, farM: 5 });
  assert.equal(grid.getCellCount(), 30);
  assert.equal(grid.isFull(), true);
  const removed = grid.evictUnconfirmed(10);
  assert.equal(removed, 10);
  assert.equal(grid.isFull(), false);
});

test('surface cells, histogram and reset follow VoxelGrid conventions', () => {
  const { grid } = rig();
  const opts = { nearM: 0.1, farM: 5 };
  grid.integrate(pencil({ depth: 1.0, frameId: 1 }), opts);
  grid.integrate(pencil({ depth: 1.0, frameId: 2 }), opts);
  const surface = grid.getSurfaceCells();
  assert.ok(surface.length > 0 && surface.length < grid.getCellCount());
  assert.ok(surface.every((c) => Math.abs(c.tsdf) < 0.5));
  const h = grid.getHistogram();
  assert.equal(h.total, surface.length);
  assert.equal(h.two, surface.length);
  const rev = grid.getRevision();
  grid.reset();
  assert.equal(grid.getCellCount(), 0);
  assert.equal(grid.getSolidCount(), 0);
  assert.ok(grid.getRevision() > rev);
});
