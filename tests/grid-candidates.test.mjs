import test from 'node:test';
import assert from 'node:assert/strict';

import { TraversalGrid } from '../src/traversal-grid.js';
import { gridCandidatePool } from '../src/grid-candidates.js';

function floor(grid, extent = 1.0) {
  for (let x = 0; x <= extent; x += 0.1) {
    for (let z = 0; z <= extent; z += 0.1) grid.observe([x, 0.02, z]);
  }
}

test('every standable level becomes a hiding candidate', () => {
  const grid = new TraversalGrid();
  floor(grid);
  grid.observe([0.5, 0.72, 0.5]); // a tabletop adds a second level in its cell
  const pool = gridCandidatePool(grid);
  const { walkable, levelTotal } = grid.stats();
  assert.ok(walkable > 0);
  assert.equal(pool.length, levelTotal);
});

test('entries carry a position on the surface and an upward-facing matrix', () => {
  const grid = new TraversalGrid();
  floor(grid);
  const [entry] = gridCandidatePool(grid);
  assert.equal(entry.pos.length, 3);
  // Identity matrix — its up axis is [0,1,0], which the placement rules read
  // as a horizontal surface.
  assert.equal(entry.matrix[5], 1);
  assert.ok(Math.abs(entry.pos[1] - 0.1) < 0.11, `y=${entry.pos[1]} should sit at floor level`);
});

test('an oversized pool is thinned evenly, not truncated at one corner', () => {
  const grid = new TraversalGrid();
  for (let x = 0; x <= 6; x += 0.1) {
    for (let z = 0; z <= 6; z += 0.1) grid.observe([x, 0.02, z]);
  }
  const pool = gridCandidatePool(grid, { maxCandidates: 100 });
  assert.equal(pool.length, 100);
  const xs = pool.map((c) => c.pos[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 4,
    'thinned candidates must still span the room');
});

test('an empty or missing grid yields an empty pool', () => {
  assert.deepEqual(gridCandidatePool(null), []);
  assert.deepEqual(gridCandidatePool(new TraversalGrid()), []);
});
