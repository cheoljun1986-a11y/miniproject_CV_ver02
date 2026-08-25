import test from 'node:test';
import assert from 'node:assert/strict';

import { TraversalGrid, MOVE } from '../src/traversal-grid.js';

function floorPatch(grid, x0, x1, z0, z1, y = 0.02, step = 0.05) {
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) grid.observe([x, y, z]);
  }
}

test('an unobserved cell is neither walkable nor blocked', () => {
  const grid = new TraversalGrid();
  assert.equal(grid.isSeen(5, 5), false);
  assert.equal(grid.isWalkable(5, 5), false);
  assert.equal(grid.isBlocked(5, 5), false);
});

test('open floor becomes walkable', () => {
  const grid = new TraversalGrid();
  floorPatch(grid, 0, 1, 0, 1);
  const cx = grid.cellX(0.5);
  const cz = grid.cellZ(0.5);
  assert.equal(grid.isWalkable(cx, cz), true);
  assert.equal(grid.levels(cx, cz).length, 1);
});

test('a wall offers nothing to stand on at floor height', () => {
  const grid = new TraversalGrid();
  for (let y = 0.02; y < 2.2; y += 0.05) grid.observe([3.1, y, 3.1]);
  const cx = grid.cellX(3.1);
  const cz = grid.cellZ(3.1);
  assert.equal(grid.isSeen(cx, cz), true);
  // Only the very top of the wall reads as a surface, and only because nothing
  // above it was scanned. Nothing at or near the floor is standable.
  const nearFloor = grid.levels(cx, cz).filter((y) => y < 1.0);
  assert.deepEqual(nearFloor, []);
});

test('a wall top is standable geometry but not reachable from the floor', async () => {
  const { reachableFrom } = await import('../src/chase-path.js');
  const { nodeKey } = await import('../src/traversal-grid.js');
  const grid = new TraversalGrid();
  floorPatch(grid, 0, 2, 0, 2);
  for (let y = 0.02; y < 2.2; y += 0.05) grid.observe([1.05, y, 1.05]);

  const wallCx = grid.cellX(1.05);
  const wallCz = grid.cellZ(1.05);
  assert.ok(grid.levels(wallCx, wallCz).length > 0, 'wall top is a surface');

  const start = grid.nodeAtWorld([0.1, 0.1, 0.1]);
  const reachable = reachableFrom(grid, start);
  assert.equal(reachable.has(nodeKey(wallCx, wallCz, 0)), false);
});

test('a table gives two standable levels in one cell', () => {
  const grid = new TraversalGrid();
  grid.observe([1.1, 0.02, 1.1]);   // floor
  grid.observe([1.1, 0.75, 1.1]);   // tabletop
  const cx = grid.cellX(1.1);
  const cz = grid.cellZ(1.1);
  const levels = grid.levels(cx, cz);
  assert.equal(levels.length, 2);
  assert.ok(levels[0] < levels[1]);
});

test('a low ceiling removes the level underneath it', () => {
  const grid = new TraversalGrid({ headroom: 0.5 });
  grid.observe([2.1, 0.02, 2.1]);
  grid.observe([2.1, 0.25, 2.1]); // only 25cm of clearance
  const cx = grid.cellX(2.1);
  const cz = grid.cellZ(2.1);
  assert.equal(grid.levels(cx, cz).includes(0.1), false);
});

test('neighbours never include unobserved cells', () => {
  const grid = new TraversalGrid();
  grid.observe([0.1, 0.02, 0.1]);
  const node = { cx: grid.cellX(0.1), cz: grid.cellZ(0.1), level: 0 };
  assert.deepEqual(grid.neighbors(node), []);
});

test('a small rise is a walk and a bigger one is a jump', () => {
  const grid = new TraversalGrid({ cellSize: 0.2, maxStepUp: 0.15, maxJumpUp: 0.7 });
  grid.observe([0.1, 0.02, 0.1]);
  grid.observe([0.3, 0.12, 0.1]); // +10cm
  grid.observe([0.5, 0.45, 0.1]); // +35cm from the second cell

  const a = { cx: grid.cellX(0.1), cz: grid.cellZ(0.1), level: 0 };
  const stepUp = grid.neighbors(a).find((n) => n.cx === grid.cellX(0.3));
  assert.equal(stepUp.move, MOVE.WALK);

  const b = { cx: grid.cellX(0.3), cz: grid.cellZ(0.1), level: 0 };
  const jump = grid.neighbors(b).find((n) => n.cx === grid.cellX(0.5));
  assert.equal(jump.move, MOVE.JUMP);
});

test('a rise beyond the jump limit is not an edge at all', () => {
  const grid = new TraversalGrid({ maxJumpUp: 0.7 });
  grid.observe([0.1, 0.02, 0.1]);
  grid.observe([0.3, 1.4, 0.1]); // shelf far above
  const node = { cx: grid.cellX(0.1), cz: grid.cellZ(0.1), level: 0 };
  assert.equal(grid.neighbors(node).some((n) => n.cx === grid.cellX(0.3)), false);
});

test('observing the same voxel twice changes nothing', () => {
  const grid = new TraversalGrid();
  assert.equal(grid.observe([1, 0.02, 1]), true);
  assert.equal(grid.observe([1, 0.02, 1]), false);
  assert.equal(grid.getRevision(), 1);
});

test('stats account for every observed cell', () => {
  const grid = new TraversalGrid();
  floorPatch(grid, 0, 0.6, 0, 0.6);
  // A column capped by a ceiling has nowhere to stand at all.
  for (let y = 0.02; y < 3.2; y += 0.05) grid.observe([5.1, y, 5.1]);
  const stats = grid.stats();
  assert.ok(stats.walkable > 0);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.seen, stats.walkable + stats.blocked);
});

test('nodeAtWorld snaps to the nearest standable level', () => {
  const grid = new TraversalGrid();
  grid.observe([1.1, 0.02, 1.1]);
  grid.observe([1.1, 0.75, 1.1]);
  const low = grid.nodeAtWorld([1.1, 0.0, 1.1]);
  const high = grid.nodeAtWorld([1.1, 0.85, 1.1]);
  assert.equal(low.level, 0);
  assert.equal(high.level, 1);
});
