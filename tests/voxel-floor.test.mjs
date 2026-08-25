import test from 'node:test';
import assert from 'node:assert/strict';

import { detectFloorY, removeFloorCells } from '../src/voxel-floor.js';

const cell = (iy, n = 1) => Array.from({ length: n }, (_, i) => ({ ix: i, iy, iz: 0 }));
const slab = (y, n, voxelSize = 0.05) => cell(Math.round(y / voxelSize), n);

test('the floor is the modal bin near the bottom of the distribution', () => {
  const cells = [...slab(-1.10, 200), ...slab(-0.40, 60)];
  const found = detectFloorY(cells, {});
  assert.ok(found);
  assert.ok(Math.abs(found.floorY - -1.10) < 1e-9);
});

// The whole reason for the percentile window: a scan dominated by a desk
// surface must still find the floor underneath it.
test('a desk with more cells than the floor does not win', () => {
  const cells = [...slab(-1.10, 80), ...slab(-0.40, 900)];
  const found = detectFloorY(cells, {});
  assert.ok(Math.abs(found.floorY - -1.10) < 1e-9, `got ${found?.floorY}`);
});

// Real scans put ~7.5% of cells below the detected plane, but they are the
// floor's own thickness — a single bin 5cm down — not a deep scatter. What the
// window must survive is a thin spread that forms no mode of its own.
test('a thin scatter below the floor does not win the mode', () => {
  const cells = [
    ...slab(-1.45, 4), ...slab(-1.40, 4), ...slab(-1.35, 4),
    ...slab(-1.30, 4), ...slab(-1.25, 4), ...slab(-1.20, 6),
    ...slab(-1.15, 40),
    ...slab(-1.10, 300),
    ...slab(-0.40, 60),
  ];
  const found = detectFloorY(cells, {});
  assert.ok(Math.abs(found.floorY - -1.10) < 1e-9, `got ${found?.floorY}`);
});

test('a flat distribution reports low confidence', () => {
  const cells = [];
  for (let iy = -22; iy <= -10; iy += 1) cells.push(...cell(iy, 40));
  const found = detectFloorY(cells, {});
  assert.ok(found.confidence < 1.5, `confidence ${found.confidence}`);
});

test('a real floor reports high confidence', () => {
  const cells = [...slab(-1.10, 219), ...slab(-1.05, 82), ...slab(-1.15, 40)];
  const found = detectFloorY(cells, {});
  assert.ok(found.confidence > 1.5, `confidence ${found.confidence}`);
});

// Cutting everything at or below the plane, not a symmetric band: a residual
// film under the floor is exactly what bridges separate objects together.
test('removal cuts below the plane and preserves order above it', () => {
  const cells = [
    { ix: 0, iy: -24, iz: 0, tag: 'under' },
    { ix: 1, iy: -22, iz: 0, tag: 'floor' },
    { ix: 2, iy: -8, iz: 0, tag: 'desk' },
    { ix: 3, iy: -2, iz: 0, tag: 'high' },
  ];
  const { kept, removedCount } = removeFloorCells(cells, { floorY: -1.10, bandM: 0.08 });
  assert.deepEqual(kept.map((c) => c.tag), ['desk', 'high']);
  assert.equal(removedCount, 2);
});

test('empty input yields no detection and a no-op removal', () => {
  assert.equal(detectFloorY([], {}), null);
  const cells = [{ ix: 0, iy: -8, iz: 0 }];
  const { kept, removedCount } = removeFloorCells(cells, { floorY: null, bandM: 0.08 });
  assert.equal(kept, cells);
  assert.equal(removedCount, 0);
});

test('the detected plane is reported with its bin population', () => {
  const found = detectFloorY([...slab(-1.10, 219), ...slab(-1.05, 82)], {});
  assert.equal(found.peakCount, 219);
  assert.equal(found.neighborCount, 82);
  assert.equal(found.binM, 0.05);
});
