import test from 'node:test';
import assert from 'node:assert/strict';

import { TraversalGrid, nodeKey } from '../src/traversal-grid.js';
import { chooseFleeTarget, findPath } from '../src/chase-path.js';

// Terrain here is drawn one voxel per surface, because these tests are about
// geometry and routing, not about how much evidence a foothold needs. The
// footing threshold has its own tests.

function room(grid, width = 4, depth = 4, step = 0.1) {
  for (let x = 0; x <= width; x += step) {
    for (let z = 0; z <= depth; z += step) grid.observe([x, 0.02, z]);
  }
}

function wall(grid, x, z0, z1, step = 0.05) {
  for (let z = z0; z <= z1; z += step) {
    for (let y = 0.02; y < 2.2; y += 0.05) grid.observe([x, y, z]);
  }
}

test('a path is a chain of adjacent cells, never a teleport', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  room(grid);
  const start = grid.nodeAtWorld([0.3, 0, 0.3]);
  const goal = grid.nodeAtWorld([3.7, 0, 3.7]);
  const path = findPath(grid, start, goal);

  assert.ok(path && path.length > 2);
  for (let i = 1; i < path.length; i += 1) {
    const dx = Math.abs(path[i].cx - path[i - 1].cx);
    const dz = Math.abs(path[i].cz - path[i - 1].cz);
    assert.ok(dx <= 1 && dz <= 1, `step ${i} jumped ${dx},${dz} cells`);
  }
});

test('a path never crosses a wall', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  room(grid);
  // Wall across the middle with a gap at the far end.
  wall(grid, 2.0, 0, 3.0);

  const start = grid.nodeAtWorld([0.3, 0, 0.3]);
  const goal = grid.nodeAtWorld([3.7, 0, 0.3]);
  const path = findPath(grid, start, goal);
  assert.ok(path, 'a way around the wall should exist');

  const wallX = grid.cellX(2.0);
  for (const node of path) {
    if (node.cx !== wallX) continue;
    assert.ok(grid.isWalkable(node.cx, node.cz), 'path entered a blocked cell');
  }
});

test('a sealed-off goal returns no path instead of cheating', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  room(grid, 4, 4);
  wall(grid, 2.0, -0.5, 4.5); // full-height wall right across
  const start = grid.nodeAtWorld([0.3, 0, 2.0]);
  const goal = grid.nodeAtWorld([3.7, 0, 2.0]);
  assert.equal(findPath(grid, start, goal), null);
});

test('the flee target keeps a minimum distance', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  room(grid);
  const from = grid.nodeAtWorld([2, 0, 2]);
  const target = chooseFleeTarget(grid, {
    from,
    playerPosition: [2, 1.5, 2],
    minDistance: 1.5,
    random: () => 0.5,
  });
  const world = grid.worldOf(target);
  const fromWorld = grid.worldOf(from);
  assert.ok(Math.hypot(world[0] - fromWorld[0], world[2] - fromWorld[2]) >= 1.5);
});

test('the flee target runs away from the player', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  room(grid, 6, 6);
  const from = grid.nodeAtWorld([3, 0, 3]);
  const near = chooseFleeTarget(grid, {
    from,
    playerPosition: [0.2, 1.5, 0.2],
    random: () => 0.5,
  });
  const world = grid.worldOf(near);
  // Should end up on the far side, not next to the player.
  assert.ok(Math.hypot(world[0] - 0.2, world[2] - 0.2) > 3);
});

test('recently visited cells are avoided', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  room(grid, 6, 6);
  const from = grid.nodeAtWorld([3, 0, 3]);

  const plain = chooseFleeTarget(grid, { from, playerPosition: [0, 1.5, 0], random: () => 0.5 });
  const visits = new Map([[nodeKey(plain.cx, plain.cz, plain.level), 1000]]);
  const avoided = chooseFleeTarget(grid, {
    from,
    playerPosition: [0, 1.5, 0],
    recentVisits: visits,
    now: 1000,
    random: () => 0.5,
  });

  assert.notEqual(
    nodeKey(avoided.cx, avoided.cz, avoided.level),
    nodeKey(plain.cx, plain.cz, plain.level),
  );
});

test('no target when there is nowhere to stand', () => {
  const grid = new TraversalGrid({ minSlabVoxels: 1 });
  assert.equal(chooseFleeTarget(grid, { from: null }), null);
});
