// Regression: the chase must be able to START on a real, properly-walked room
// scan. When the default game terrain switched to the keyframe/TSDF pipeline it
// confirms voxels far more conservatively than the old legacy map, so the same
// walk yields fewer walkable cells. CHASE_MIN_WALKABLE_CELLS was tuned for the
// old dense terrain, so a genuine room scan fell under the gate and freezing the
// map never started the chase — Hachuping simply never appeared.
//
// The fixture is a real on-device capture (keyframe terrain, 9 keyframes, a
// 47-point walk) exported by the dev server. It stands in for the offline
// validation the terrain work was tuned against.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TraversalGrid } from '../src/traversal-grid.js';
import {
  CHASE_CELL_SIZE_M,
  CHASE_SLAB_HEIGHT_M,
  CHASE_MIN_WALKABLE_CELLS,
} from '../src/config.js';
import { gridCandidatePool } from '../src/grid-candidates.js';

function loadRoomGrid() {
  const path = fileURLToPath(new URL('./fixtures/room-scan-keyframe.json', import.meta.url));
  const scan = JSON.parse(readFileSync(path, 'utf8'));
  const grid = new TraversalGrid({
    cellSize: CHASE_CELL_SIZE_M,
    slabHeight: CHASE_SLAB_HEIGHT_M,
  });
  // cells: [ix, iy, iz, count, cx, cy, cz] — world centre is columns 4..6, the
  // same value main.js feeds chaseGrid.observe(toMapSpace(center)).
  for (const c of scan.cells) grid.observe([c[4], c[5], c[6]]);
  return grid;
}

test('a real room scan has hiding spots to place Hachuping', () => {
  const grid = loadRoomGrid();
  assert.ok(gridCandidatePool(grid).length > 0, 'no candidate hiding spots in a real room scan');
});

test('a real room scan clears the walkable gate so the chase can start', () => {
  const grid = loadRoomGrid();
  const { walkable } = grid.stats();
  assert.ok(
    walkable >= CHASE_MIN_WALKABLE_CELLS,
    `a walked room yields ${walkable} walkable cells but the chase needs ${CHASE_MIN_WALKABLE_CELLS}; `
    + 'the gate is tuned above what the default terrain reaches, so the chase never starts',
  );
});
