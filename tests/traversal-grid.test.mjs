import test from 'node:test';
import assert from 'node:assert/strict';

import { TraversalGrid, MOVE, nodeKey } from '../src/traversal-grid.js';
import { findPath, reachableFrom } from '../src/chase-path.js';

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
  grid.observe([0.5, 0.40, 0.1]); // +28cm from the second cell

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
  // The observed floor height, not the slab top 8cm above it.
  assert.ok(Math.abs(levels[0] - 0.02) < 1e-6, `got ${levels[0]}`);
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
  assert.ok(Math.abs(levels[0] - 0.02) < 1e-6, `got ${levels[0]}`);
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
  assert.ok(Math.abs(after[0] - 0.02) < 1e-6, `got ${after[0]}`);
});

// ── pre-built-map era movement rules ─────────────────────────

test('a neighbouring cell offers BOTH its floor and its tabletop as edges', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  // Broad floor so the floor estimate settles.
  for (let x = 0; x <= 1.0; x += 0.1) {
    for (let z = 0; z <= 1.0; z += 0.1) grid.observe([x, 0.02, z]);
  }
  // A tabletop wide enough to read as a platform. A single raised cell is
  // rejected on purpose now — that shape is what noise looks like.
  for (let x = 0.3; x <= 0.7; x += 0.1) {
    for (let z = 0.3; z <= 0.7; z += 0.1) grid.observe([x, 0.72, z]);
  }

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
  for (let x = 0.3; x <= 0.7; x += 0.1) {
    for (let z = 0.3; z <= 0.7; z += 0.1) grid.observe([x, 0.72, z]);
  }
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

// ── climbing furniture without climbing noise ────────────────
function roomWithDeskAndNoise(options = {}) {
  const grid = new TraversalGrid(options);
  for (let x = 0; x <= 2.4; x += 0.025) {
    for (let z = 0; z <= 1.0; z += 0.025) grid.observe([x, 0.02, z]);
  }
  // Hip-height desk, 60cm square — a real platform.
  for (let x = 1.2; x <= 1.8; x += 0.025) {
    for (let z = 0.2; z <= 0.8; z += 0.025) grid.observe([x, 0.90, z]);
  }
  // Reconstruction noise: one cell's worth of voxels floating in mid-air.
  for (const [dx, dz] of [[0, 0], [0.06, 0], [0, 0.06], [0.06, 0.06]]) {
    grid.observe([0.40 + dx, 0.85, 0.50 + dz]);
  }
  return grid;
}

test('hip-height furniture is reachable from the floor', () => {
  const grid = roomWithDeskAndNoise();
  const reachable = reachableFrom(grid, grid.nodeAtWorld([0.1, 0.1, 0.5]));
  const desk = grid.nodeAtWorld([1.5, 0.95, 0.5]);
  assert.ok(desk, 'the desktop should be standable geometry');
  assert.ok(
    reachable.has(nodeKey(desk.cx, desk.cz, desk.level)),
    'a 90cm desk must be climbable, or the room\'s furniture goes unused',
  );
});

test('an isolated blob at the same height is not', () => {
  const grid = roomWithDeskAndNoise();
  const reachable = reachableFrom(grid, grid.nodeAtWorld([0.1, 0.1, 0.5]));
  const noise = grid.nodeAtWorld([0.42, 0.90, 0.52]);
  assert.ok(
    !reachable.has(nodeKey(noise.cx, noise.cz, noise.level)),
    'raising the jump height must not hand over every stray artefact',
  );
});

test('the platform test counts neighbours at a similar height', () => {
  const grid = roomWithDeskAndNoise();
  const desk = grid.nodeAtWorld([1.5, 0.95, 0.5]);
  const noise = grid.nodeAtWorld([0.42, 0.90, 0.52]);
  assert.equal(grid.hasRaisedSupport(desk.cx, desk.cz, grid.worldOf(desk)[1]), true);
  assert.equal(grid.hasRaisedSupport(noise.cx, noise.cz, grid.worldOf(noise)[1]), false);
});

test('ground-level cells skip the platform test entirely', () => {
  // Otherwise a lone scanned patch of floor at the edge of the map would be
  // unreachable, and the map is always ragged at its edges.
  const grid = roomWithDeskAndNoise();
  const floor = grid.nodeAtWorld([0.1, 0.1, 0.5]);
  assert.equal(grid.hasRaisedSupport(floor.cx, floor.cz, grid.worldOf(floor)[1]), true);
});

test('a character stranded on a blob can still get down', () => {
  // The platform test gates climbing only. Gating descent too would strand
  // Hachuping forever if it ever ended up somewhere unsupported.
  const grid = roomWithDeskAndNoise();
  const noise = grid.nodeAtWorld([0.42, 0.90, 0.52]);
  const down = grid.neighbors(noise).filter((n) => n.rise < -0.2);
  assert.ok(down.length > 0, 'there must be a way down');
});

test('a taller climb takes longer and arcs higher', async () => {
  const { ChaseRunner } = await import('../src/chase-runner.js');
  const runner = new ChaseRunner({ grid: new TraversalGrid({ minSlabVoxels: 1 }) });
  const small = runner.jumpShapeFor(0.15);
  const big = runner.jumpShapeFor(0.90);
  assert.ok(big.seconds > small.seconds);
  assert.ok(big.arc > small.arc);
});

// TSDF fusion can take a voxel back. The slab bit is reference counted, so a
// retraction only clears it when no other voxel still supports that slab.
test('unobserve releases a slab only when its last voxel is retracted', () => {
  // Threshold 1: this test is about the vote refcount, not footing evidence —
  // the threshold-crossing retraction has its own test below.
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  floorPatch(grid, 0, 1, 0, 1);
  const cx = grid.cellX(0.1);
  const cz = grid.cellZ(0.1);
  const floorY = grid.levels(cx, cz)[0];
  // A floater 30cm up steals the floor's headroom and reads as a ledge, so
  // the only standable level moves up to it.
  const floater = [0.1, 0.32, 0.1];
  grid.observe(floater);
  grid.observe([0.12, 0.33, 0.12]); // a second voxel in the same slab
  assert.deepEqual(grid.levels(cx, cz).length, 1);
  assert.ok(grid.levels(cx, cz)[0] > floorY + 0.2, 'standing on the floater');

  assert.equal(grid.unobserve(floater), false, 'one vote remains');
  assert.ok(grid.levels(cx, cz)[0] > floorY + 0.2);
  assert.equal(grid.unobserve([0.12, 0.33, 0.12]), true, 'last vote clears the slab');
  assert.equal(grid.levels(cx, cz)[0], floorY, 'back on the floor');
  assert.equal(grid.unobserve(floater), false, 'nothing left to retract');
});

test('a cell whose every voxel is retracted reads as unseen, not blocked', () => {
  const grid = new TraversalGrid();
  const point = [2.1, 0.02, 2.1];
  grid.observe(point);
  const cx = grid.cellX(2.1);
  const cz = grid.cellZ(2.1);
  assert.equal(grid.isSeen(cx, cz), true);
  const revision = grid.getRevision();
  grid.unobserve(point);
  assert.equal(grid.isSeen(cx, cz), false);
  assert.equal(grid.isBlocked(cx, cz), false);
  assert.ok(grid.getRevision() > revision);
  assert.equal(grid.stats().seen, 0);
});

test('a retraction that drops below the footing threshold clears the bit', () => {
  // Default threshold (4): the fourth voxel confirms the foothold, and
  // retracting one of them un-confirms it — TSDF taking back one noisy voxel
  // must take the evidence budget with it.
  const grid = new TraversalGrid();
  const pts = [[0.01, 0.02, 0.01], [0.07, 0.02, 0.01], [0.01, 0.02, 0.07], [0.07, 0.02, 0.07]];
  for (const p of pts) grid.observe(p);
  assert.equal(grid.levels(0, 0).length, 1, 'confirmed at four votes');

  assert.equal(grid.unobserve(pts[0]), true, 'crossing back below the threshold');
  assert.equal(grid.levels(0, 0).length, 0, 'no longer standable');
  // The remaining three votes stay banked: one more voxel re-confirms.
  assert.equal(grid.observe([0.13, 0.02, 0.13]), true);
  assert.equal(grid.levels(0, 0).length, 1);
});

// ── floor detection sits on the peak, not the shoulder ───────
test('a floor spread over several slabs resolves to its busiest one', () => {
  // Real scans never put the floor in one clean slab: depth noise spreads it
  // over three or four, and taking the lowest qualifying slab landed 10-20cm
  // below the actual surface on every room scan we have. Everything measured
  // "above the floor" — the height toll, the platform test, the standable
  // ceiling — inherited that error.
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  const put = (y, count) => {
    for (let i = 0; i < count; i += 1) {
      grid.observe([(i % 40) * 0.2 + 0.05, y, Math.floor(i / 40) * 0.2 + 0.05]);
    }
  };
  put(-1.45, 40);   // bottom shoulder
  put(-1.35, 120);  // the real surface
  put(-1.25, 60);   // top shoulder
  const slab = grid.resolveFloorSlab();
  assert.ok(
    Math.abs(grid.slabTopY(slab) - grid.slabTopY(grid.slabOf(-1.35))) < 1e-9,
    `floor landed at ${grid.slabTopY(slab)}, expected the busiest slab`,
  );
});

test('climbing to the peak stops before a separate surface higher up', () => {
  // The walk-up must not wander off the floor cluster onto a desk plane.
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  const put = (y, count) => {
    for (let i = 0; i < count; i += 1) {
      grid.observe([(i % 40) * 0.2 + 0.05, y, Math.floor(i / 40) * 0.2 + 0.05]);
    }
  };
  put(-1.45, 60);
  put(-1.35, 200);  // floor peak
  put(-1.25, 80);   // decreasing — the walk-up stops here
  put(-0.65, 400);  // a huge desk plane, deliberately busier than the floor
  const slab = grid.resolveFloorSlab();
  assert.ok(grid.slabTopY(slab) < -1.2, `floor jumped up to ${grid.slabTopY(slab)}`);
});

test('the furniture-reluctance costs are tunable, not baked in', () => {
  const cheap = new TraversalGrid({ minSlabVoxels: 1, heightTollPerM: 0 });
  const dear = new TraversalGrid({ minSlabVoxels: 1, heightTollPerM: 4 });
  for (const g of [cheap, dear]) {
    for (let x = 0; x <= 1.4; x += 0.05) {
      for (let z = 0; z <= 0.6; z += 0.05) g.observe([x, 0.02, z]);
    }
    for (let x = 0.6; x <= 1.0; x += 0.05) {
      for (let z = 0; z <= 0.6; z += 0.05) g.observe([x, 0.50, z]);
    }
  }
  const shelfOf = (g) => {
    const from = g.nodeAtWorld([0.3, 0.1, 0.3]);
    return g.neighbors(from).find((n) => n.rise > 0.2);
  };
  assert.ok(shelfOf(dear).cost > shelfOf(cheap).cost, 'the toll must reach the cost');
});

// ── overhead clearance ───────────────────────────────────────
// A 34cm character fits under a desk, so "the body fits" let it spend whole
// chases invisible under furniture. Standing somewhere and being somewhere
// worth going are different questions; this is the second one.

test('a floor under a desk is not somewhere to stand', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1, minOverhead: 1.0 });
  floorPatch(grid, 0, 2, 0, 2);
  const cx = grid.cellX(1.1);
  const cz = grid.cellZ(1.1);
  assert.equal(grid.levels(cx, cz).length, 1, 'open floor is fine');

  // A desk top 70cm up: the body fits under it, a metre of clearance does not.
  grid.observe([1.1, 0.72, 1.1]);
  const levels = grid.levels(cx, cz);
  assert.equal(levels.length, 1, 'only one level survives');
  assert.ok(levels[0] > 0.5, 'and it is the desk top, not the floor beneath it');
});

test('the desk top itself stays standable', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1, minOverhead: 1.0 });
  floorPatch(grid, 0, 2, 0, 2);
  floorPatch(grid, 0.6, 1.6, 0.6, 1.6, 0.72);
  const levels = grid.levels(grid.cellX(1.1), grid.cellZ(1.1));
  assert.equal(levels.length, 1);
  // Within a slab of the observed surface: feet land on the slab TOP, so the
  // reported height runs up to 10cm above what was actually measured. That
  // quantisation is a separate defect (the character visibly floats); this
  // test only cares that the level is the desk and not the floor.
  assert.ok(Math.abs(levels[0] - 0.72) <= grid.slabHeight, `stands on the desk, got ${levels[0]}`);
});

// The clearance is a gameplay rule layered on a physical one; it can never ask
// for less room than the body actually occupies.
test('the clearance never drops below the body height', () => {
  const grid = new TraversalGrid({ headroom: 0.5, minOverhead: 0.1 });
  assert.equal(grid.overheadSlabs, grid.headroomSlabs);
});

test('open floor far from furniture is untouched by the rule', () => {
  const strict = new TraversalGrid({ minSlabVoxels: 1, minOverhead: 1.0 });
  const loose = new TraversalGrid({ minSlabVoxels: 1 });
  for (const grid of [strict, loose]) floorPatch(grid, 0, 2, 0, 2);
  assert.equal(strict.stats().walkable, loose.stats().walkable);
});

// ── refined standing heights ─────────────────────────────────
// The fusion can say where a surface actually is, to the millimetre. Without
// this the character stands on the slab TOP, up to 10cm off (measured on a real
// scan: a median of 49mm too high — it visibly floats).

test('a slab with refined samples stands the character at their mean', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  // Three voxels of one footing, all inside the same slab, surface at ~0.043.
  grid.observe([0.1, 0.02, 0.1], 0.041);
  grid.observe([0.12, 0.02, 0.12], 0.043);
  grid.observe([0.14, 0.02, 0.14], 0.045);
  const [y] = grid.levels(grid.cellX(0.1), grid.cellZ(0.1));
  assert.ok(Math.abs(y - 0.043) < 1e-6, `got ${y}`);
});

// Every observation carries a height — the voxel centre when the fusion could
// not resolve a crossing — so the slab top survives only where a footing was
// synthesised with no height at all.
test('a footing with no height sample at all falls back to the slab top', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  const slab = grid.slabOf(0.02);
  grid.addSyntheticFloor(grid.cellX(0.1), grid.cellZ(0.1), slab);
  assert.equal(grid.levels(grid.cellX(0.1), grid.cellZ(0.1))[0], grid.slabTopY(slab));
});

// The load-bearing invariant: heights must not decide slabs. Letting them would
// split a flat surface's votes across two slabs, drop cells under the footing
// threshold and erase walkable ground.
test('the refined height never changes which slab a voxel votes in', () => {
  const plain = new TraversalGrid({ minSlabVoxels: 1 });
  const refined = new TraversalGrid({ minSlabVoxels: 1 });
  for (let x = 0; x <= 1; x += 0.05) {
    for (let z = 0; z <= 1; z += 0.05) {
      plain.observe([x, 0.02, z]);
      // A height near the slab boundary, which naive code would round into the
      // slab below.
      refined.observe([x, 0.02, z], -0.004);
    }
  }
  assert.deepEqual(Array.from(refined.slabCells), Array.from(plain.slabCells));
  assert.equal(refined.resolveFloorSlab(), plain.resolveFloorSlab());
  assert.deepEqual(refined.stats(), plain.stats());
});

// Bounded, but not clamped hard to the slab: a refined crossing legitimately
// sits a little outside the slab holding its voxel centre, and squeezing it
// back in would put the 10cm step right at the boundary again.
test('an absurd height is bounded to half a slab outside its own', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  grid.observe([0.1, 0.02, 0.1], -0.5);
  const [y] = grid.levels(grid.cellX(0.1), grid.cellZ(0.1));
  const slab = grid.slabOf(0.02);
  const bottom = grid.minY + slab * grid.slabHeight;
  assert.ok(y >= bottom - grid.slabHeight / 2 - 1e-9, `${y} escaped the bound`);
  assert.ok(Math.abs(y - (bottom - grid.slabHeight / 2)) < 1e-9, 'clamped to the bound');
});

test('a height just outside its slab is kept, not snapped back in', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  // 1cm below the slab its voxel centre sits in — a plausible crossing.
  const slab = grid.slabOf(0.02);
  const justBelow = grid.minY + slab * grid.slabHeight - 0.01;
  grid.observe([0.1, 0.02, 0.1], justBelow);
  assert.ok(Math.abs(grid.levels(grid.cellX(0.1), grid.cellZ(0.1))[0] - justBelow) < 1e-9);
});

test('retracting a refined voxel restores the height it contributed', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  grid.observe([0.1, 0.02, 0.1], 0.030);
  grid.observe([0.12, 0.02, 0.12], 0.050);
  const cx = grid.cellX(0.1);
  const cz = grid.cellZ(0.1);
  assert.ok(Math.abs(grid.levels(cx, cz)[0] - 0.040) < 1e-6);

  grid.unobserve([0.12, 0.02, 0.12], 0.050);
  assert.ok(Math.abs(grid.levels(cx, cz)[0] - 0.030) < 1e-6, 'back to the first sample');

  grid.unobserve([0.1, 0.02, 0.1], 0.030);
  assert.equal(grid.isSeen(cx, cz), false, 'the cell is gone entirely');
});

test('synthetic floor is filled at the observed floor height, not the slab top', async () => {
  const { fitFloorPlane } = await import('../src/plane-fit.js');
  const grid = new TraversalGrid({ minSlabVoxels: 1, floorMinCells: 1 });
  // An observed floor with a real height, and one gap cell inside it.
  for (let x = 0; x <= 1.0; x += 0.2) {
    for (let z = 0; z <= 1.0; z += 0.2) {
      if (Math.abs(x - 0.6) < 0.01 && Math.abs(z - 0.6) < 0.01) continue;
      grid.observe([x, -1.05, z], -1.043);
    }
  }
  const observed = grid.levels(grid.cellX(0.2), grid.cellZ(0.2))[0];
  assert.ok(Math.abs(observed - -1.043) < 1e-6);

  const plane = fitFloorPlane(grid.occupiedVoxelPoints(), { now: () => 0 });
  grid.applyFloorPlane(plane ?? { normal: [0, 1, 0], d: -1.043 }, { fillRadius: 2 });

  const filled = grid.levels(grid.cellX(0.6), grid.cellZ(0.6))[0];
  assert.ok(filled !== undefined, 'the gap was filled');
  // No 10cm cliff at the seam between scanned and synthesised floor.
  assert.ok(Math.abs(filled - observed) < 1e-6, `seam step of ${Math.abs(filled - observed)}m`);
});
