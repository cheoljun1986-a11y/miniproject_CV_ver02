import test from 'node:test';
import assert from 'node:assert/strict';

import { TraversalGrid, MOVE } from '../src/traversal-grid.js';
import { findPath } from '../src/chase-path.js';

// Terrain here is drawn one voxel per surface, because these tests are about
// geometry and routing, not about how much evidence a foothold needs. The
// footing threshold has its own tests.

function floorPatch(grid, x0, x1, z0, z1, y = 0.02, step = 0.05) {
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) grid.observe([x, y, z]);
  }
}

test('an unobserved cell is neither walkable nor blocked', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  assert.equal(grid.isSeen(5, 5), false);
  assert.equal(grid.isWalkable(5, 5), false);
  assert.equal(grid.isBlocked(5, 5), false);
});

test('open floor becomes walkable', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  floorPatch(grid, 0, 1, 0, 1);
  const cx = grid.cellX(0.5);
  const cz = grid.cellZ(0.5);
  assert.equal(grid.isWalkable(cx, cz), true);
  assert.equal(grid.levels(cx, cz).length, 1);
});

test('a wall offers nothing to stand on at floor height', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
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
  // The height cap is lifted here so the reachability rule is what is under
  // test rather than the cap; the cap gets its own tests below.
  const grid = new TraversalGrid({ minSlabVoxels: 1, maxStandAboveFloor: 100 });
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
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  grid.observe([1.1, 0.02, 1.1]);   // floor
  grid.observe([1.1, 0.75, 1.1]);   // tabletop
  const cx = grid.cellX(1.1);
  const cz = grid.cellZ(1.1);
  const levels = grid.levels(cx, cz);
  assert.equal(levels.length, 2);
  assert.ok(levels[0] < levels[1]);
});

test('a low ceiling removes the level underneath it', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1, headroom: 0.5 });
  grid.observe([2.1, 0.02, 2.1]);
  grid.observe([2.1, 0.25, 2.1]); // only 25cm of clearance
  const cx = grid.cellX(2.1);
  const cz = grid.cellZ(2.1);
  assert.equal(grid.levels(cx, cz).includes(0.1), false);
});

test('neighbours never include unobserved cells', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  grid.observe([0.1, 0.02, 0.1]);
  const node = { cx: grid.cellX(0.1), cz: grid.cellZ(0.1), level: 0 };
  assert.deepEqual(grid.neighbors(node), []);
});

test('a small rise is a walk and a bigger one is a jump', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1, cellSize: 0.2, maxStepUp: 0.15, maxJumpUp: 0.7 });
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
  const grid = new TraversalGrid({ minSlabVoxels: 1, maxJumpUp: 0.7 });
  grid.observe([0.1, 0.02, 0.1]);
  grid.observe([0.3, 1.4, 0.1]); // shelf far above
  const node = { cx: grid.cellX(0.1), cz: grid.cellZ(0.1), level: 0 };
  assert.equal(grid.neighbors(node).some((n) => n.cx === grid.cellX(0.3)), false);
});

test('observing the same voxel twice changes nothing', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  assert.equal(grid.observe([1, 0.02, 1]), true);
  assert.equal(grid.observe([1, 0.02, 1]), false);
  assert.equal(grid.getRevision(), 1);
});

test('stats account for every observed cell', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  floorPatch(grid, 0, 0.6, 0, 0.6);
  // A column capped by a ceiling has nowhere to stand at all.
  for (let y = 0.02; y < 3.2; y += 0.05) grid.observe([5.1, y, 5.1]);
  const stats = grid.stats();
  assert.ok(stats.walkable > 0);
  assert.equal(stats.blocked, 1);
  assert.equal(stats.seen, stats.walkable + stats.blocked);
});

test('nodeAtWorld snaps to the nearest standable level', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  grid.observe([1.1, 0.02, 1.1]);
  grid.observe([1.1, 0.75, 1.1]);
  const low = grid.nodeAtWorld([1.1, 0.0, 1.1]);
  const high = grid.nodeAtWorld([1.1, 0.85, 1.1]);
  assert.equal(low.level, 0);
  assert.equal(high.level, 1);
});

// ── height cap ───────────────────────────────────────────────
// A ceiling is a flat surface with clear air below it, exactly like a tabletop.
// Only its height separates the two, so the grid refuses surfaces that sit too
// far above the detected floor. Without this Hachuping climbed onto the
// ceiling during a live test.
test('a ceiling is not somewhere to stand', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  floorPatch(grid, 0, 2, 0, 2);
  floorPatch(grid, 0, 2, 0, 2, 2.4);
  const cx = grid.cellX(1.1);
  const cz = grid.cellZ(1.1);
  const levels = grid.levels(cx, cz);
  assert.equal(levels.length, 1);
  assert.ok(Math.abs(levels[0] - 0.1) < 1e-6);
});

test('furniture height still counts', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  floorPatch(grid, 0, 2, 0, 2);
  grid.observe([1.1, 0.75, 1.1]);   // tabletop
  const levels = grid.levels(grid.cellX(1.1), grid.cellZ(1.1));
  assert.equal(levels.length, 2);
  assert.ok(levels[1] > 0.7 && levels[1] < 0.9);
});

test('the cap follows the floor rather than the grid origin', () => {
  // A real session puts the origin at the phone, roughly 1.4m above the floor,
  // so every useful height is negative. A fixed cap would erase the whole map.
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  floorPatch(grid, 0, 2, 0, 2, -1.4);
  floorPatch(grid, 0, 2, 0, 2, 1.0); // ceiling, 2.4m above that floor
  const levels = grid.levels(grid.cellX(1.1), grid.cellZ(1.1));
  assert.equal(levels.length, 1);
  assert.ok(levels[0] < -1.2);
});

test('a few stray points below the floor do not raise the cap', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  floorPatch(grid, 0, 2, 0, 2);
  grid.observe([0.05, -1.5, 0.05]); // depth noise well under the floor
  floorPatch(grid, 0, 2, 0, 2, 2.4);
  const levels = grid.levels(grid.cellX(1.1), grid.cellZ(1.1));
  assert.equal(levels.length, 1);
  assert.ok(Math.abs(levels[0] - 0.1) < 1e-6);
});

test('the cap is re-applied when the floor is found later', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  // Scanned high first: with nothing else known this reads as the floor.
  floorPatch(grid, 0, 2, 0, 2, 2.4);
  assert.ok(grid.isWalkable(grid.cellX(1.1), grid.cellZ(1.1)));
  // The real floor turns up, and the earlier surface is now out of reach.
  floorPatch(grid, 0, 2, 0, 2);
  const after = grid.levels(grid.cellX(1.1), grid.cellZ(1.1));
  assert.equal(after.length, 1);
  assert.ok(Math.abs(after[0] - 0.1) < 1e-6);
});

// ── pre-built-map era movement rules ─────────────────────────

test('a neighbouring cell offers BOTH its floor and its tabletop as edges', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  // Broad floor so the floor estimate settles.
  for (let x = 0; x <= 1.0; x += 0.1) {
    for (let z = 0; z <= 1.0; z += 0.1) grid.observe([x, 0.02, z]);
  }
  // A tabletop over one cell, high enough to leave headroom underneath.
  grid.observe([0.5, 0.72, 0.5]);

  const from = grid.nodeAtWorld([0.3, 0.1, 0.5]);
  const toCell = { cx: grid.cellX(0.5), cz: grid.cellZ(0.5) };
  const offered = grid.neighbors(from)
    .filter((n) => n.cx === toCell.cx && n.cz === toCell.cz);
  // The old code offered only the level nearest the current height, which made
  // furniture a one-way trap. Both must exist now.
  assert.ok(offered.length >= 2, `expected floor and tabletop edges, got ${offered.length}`);
});

test('the floor route is cheaper than the furniture route', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  for (let x = 0; x <= 1.0; x += 0.1) {
    for (let z = 0; z <= 1.0; z += 0.1) grid.observe([x, 0.02, z]);
  }
  grid.observe([0.5, 0.72, 0.5]);
  const from = grid.nodeAtWorld([0.3, 0.1, 0.5]);
  const offered = grid.neighbors(from)
    .filter((n) => n.cx === grid.cellX(0.5) && n.cz === grid.cellZ(0.5));
  const floorEdge = offered.reduce((a, b) => (a.rise < b.rise ? a : b));
  const tableEdge = offered.reduce((a, b) => (a.rise > b.rise ? a : b));
  assert.ok(floorEdge.cost < tableEdge.cost,
    `floor ${floorEdge.cost} should undercut table ${tableEdge.cost}`);
});

test('a path across a room with a table goes under it, not over it', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  for (let x = 0; x <= 2.0; x += 0.1) {
    for (let z = 0; z <= 0.6; z += 0.1) grid.observe([x, 0.02, z]);
  }
  // Tabletop strip across the middle, floor beneath still has headroom.
  for (let x = 0.8; x <= 1.2; x += 0.1) {
    for (let z = 0; z <= 0.6; z += 0.1) grid.observe([x, 0.72, z]);
  }
  const start = grid.nodeAtWorld([0.1, 0.1, 0.3]);
  const goal = grid.nodeAtWorld([1.9, 0.1, 0.3]);
  const path = findPath(grid, start, goal);
  assert.ok(path, 'a route must exist');
  for (const node of path) {
    const world = grid.worldOf(node);
    assert.ok(world[1] < 0.4, `expected a ground route, but a step sits at y=${world[1]}`);
  }
});

// ── footing needs evidence, not a single point ───────────────
test('one stray voxel no longer conjures a foothold', () => {
  const grid = new TraversalGrid(); // default threshold
  assert.equal(grid.observe([0.05, 0.02, 0.05]), false);
  assert.deepEqual(grid.levels(0, 0), []);
});

test('the foothold appears exactly on the fourth voxel in that slab', () => {
  const grid = new TraversalGrid();
  const pts = [[0.05, 0.02, 0.05], [0.11, 0.02, 0.05], [0.05, 0.02, 0.11], [0.11, 0.02, 0.11]];
  for (let i = 0; i < 3; i += 1) {
    assert.equal(grid.observe(pts[i]), false, `voxel ${i + 1} must not confirm`);
    assert.equal(grid.levels(0, 0).length, 0);
  }
  assert.equal(grid.observe(pts[3]), true);
  assert.equal(grid.levels(0, 0).length, 1);
});

test('evidence is counted per slab, not per cell', () => {
  // Three voxels low and three high: neither slab reaches four, so no level.
  const grid = new TraversalGrid();
  for (const y of [0.02, 0.04, 0.06]) grid.observe([0.05 + y, y, 0.05]);
  for (const y of [0.72, 0.74, 0.76]) grid.observe([0.05 + y - 0.7, y, 0.05]);
  assert.deepEqual(grid.levels(0, 0), []);
});

test('a fully observed flat floor clears the threshold comfortably', () => {
  // A real 20x20cm patch of floor leaves 16 voxels in its slab.
  const grid = new TraversalGrid();
  for (let x = 0.01; x < 0.20; x += 0.02) {
    for (let z = 0.01; z < 0.20; z += 0.02) grid.observe([x, 0.02, z]);
  }
  assert.equal(grid.levels(0, 0).length, 1);
});

test('the threshold is configurable so it can be retuned on device', () => {
  const strict = new TraversalGrid({ minSlabVoxels: 8 });
  for (let i = 0; i < 6; i += 1) strict.observe([0.01 + i * 0.03, 0.02, 0.05]);
  assert.deepEqual(strict.levels(0, 0), []);
});
