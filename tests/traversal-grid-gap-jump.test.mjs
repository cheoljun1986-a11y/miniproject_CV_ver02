import test from 'node:test';
import assert from 'node:assert/strict';

import { TraversalGrid, MOVE } from '../src/traversal-grid.js';
import { findPath } from '../src/chase-path.js';
import { ChaseRunner } from '../src/chase-runner.js';

// Leaping a one-cell gap. The footing rules (minSlabVoxels, minNeighbours)
// thin the map on purpose, so a table top can split into islands one cell
// apart; these check the leap that re-joins them, and the guards on it.

function floorPatch(grid, x0, x1, z0, z1, y = 0.02, step = 0.05) {
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) grid.observe([x, y, z]);
  }
}

// Floor on cells x 0..4 and 6..11, nothing at all in cell 5 (x 1.0..1.2).
function splitFloor(options = {}) {
  const grid = new TraversalGrid({ minSlabVoxels: 1, ...options });
  floorPatch(grid, 0.0, 0.97, 0, 1);
  floorPatch(grid, 1.22, 2.3, 0, 1);
  return grid;
}

test('without gap jumps a one-cell hole splits the floor in two', () => {
  const grid = splitFloor();
  const from = grid.nodeAtWorld([0.5, 0.02, 0.5]);
  const to = grid.nodeAtWorld([1.7, 0.02, 0.5]);
  assert.equal(findPath(grid, from, to), null);
});

test('with gap jumps the hole is crossed by a single leap edge', () => {
  const grid = splitFloor({ gapJumpCells: 1 });
  const from = grid.nodeAtWorld([0.5, 0.02, 0.5]);
  const to = grid.nodeAtWorld([1.7, 0.02, 0.5]);
  const path = findPath(grid, from, to);
  assert.ok(path, 'a path exists');
  const leaps = path.filter((n) => n.move === MOVE.JUMP);
  assert.equal(leaps.length, 1);
  assert.equal(leaps[0].gap, 1);
  assert.equal(leaps[0].cx, 6, 'lands on the first cell past the hole');
  // Every other step is an ordinary adjacent walk.
  for (let i = 1; i < path.length; i += 1) {
    const step = Math.max(Math.abs(path[i].cx - path[i - 1].cx), Math.abs(path[i].cz - path[i - 1].cz));
    assert.ok(step <= (path[i].move === MOVE.JUMP ? 2 : 1));
  }
});

test('a leap is never offered where walking already works', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1, gapJumpCells: 1 });
  floorPatch(grid, 0, 2, 0, 2);
  const node = grid.nodeAtWorld([1.0, 0.02, 1.0]);
  const leaps = grid.neighbors(node).filter((e) => e.gap > 0);
  assert.deepEqual(leaps, []);
});

test('a leap costs more than the two walks it replaces', () => {
  const grid = splitFloor({ gapJumpCells: 1 });
  const node = grid.nodeAtWorld([0.9, 0.02, 0.5]);
  const leap = grid.neighbors(node).find((e) => e.gap === 1 && e.cx === 6 && e.cz === node.cz);
  assert.ok(leap, 'straight leap exists');
  assert.ok(leap.cost > 2 * grid.cellSize + grid.jumpBaseCost);
});

test('a wall standing in the gap cannot be leapt through', () => {
  const grid = splitFloor({ gapJumpCells: 1 });
  // A wall the whole width of the gap cell, taller than any jump (0.95m) and
  // the standable ceiling (1.3m above the floor), so its top is no route either.
  for (let z = 0; z <= 1; z += 0.05) {
    for (let y = 0.02; y < 1.6; y += 0.05) grid.observe([1.1, y, z]);
  }
  const from = grid.nodeAtWorld([0.5, 0.02, 0.5]);
  const to = grid.nodeAtWorld([1.7, 0.02, 0.5]);
  assert.equal(findPath(grid, from, to), null);
});

test('a leap onto higher ground still obeys the jump height limit', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1, gapJumpCells: 1, maxJumpUp: 0.5 });
  floorPatch(grid, 0.0, 0.97, 0, 1);
  floorPatch(grid, 1.22, 2.3, 0, 1, 0.82); // 80cm up: past the limit
  const from = grid.nodeAtWorld([0.5, 0.02, 0.5]);
  const to = grid.nodeAtWorld([1.7, 0.82, 0.5]);
  assert.equal(findPath(grid, from, to), null);
});

test('the runner takes longer over a two-cell leap than a one-cell hop', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  const runner = new ChaseRunner({ grid });
  const hop = runner.jumpShapeFor(0.3, grid.cellSize);
  const leap = runner.jumpShapeFor(0.3, grid.cellSize * 2);
  assert.ok(leap.seconds > hop.seconds);
  assert.ok(leap.arc > hop.arc);
  // A plain hop is unchanged from before the planar term existed.
  assert.deepEqual(runner.jumpShapeFor(0.3), hop);
});
