// Hiding-spot candidates taken straight from the frozen traversal grid.
//
// The original flow collected candidates one at a time from wherever the
// crosshair's hit-test happened to land during a 20-second timer. With a
// pre-built map that is backwards: the grid already knows every place a small
// character can stand, so the pool is simply those cells — no aiming, no
// timer, and hiding spots exist everywhere the player actually scanned.
//
// Entries match the shape the placement rules expect ({ pos, matrix }): every
// standable level is a horizontal surface, so the matrix is identity and its
// up-axis reads as [0, 1, 0].

const UP_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

export function gridCandidatePool(grid, { maxCandidates = 600 } = {}) {
  if (!grid) return [];
  const all = [];
  for (const cell of grid.cells.values()) {
    const levels = grid.levels(cell.cx, cell.cz);
    for (const y of levels) {
      all.push({
        pos: [grid.centerX(cell.cx), y, grid.centerZ(cell.cz)],
        matrix: Array.from(UP_MATRIX),
      });
    }
  }
  if (all.length <= maxCandidates) return all;

  // Evenly thin an oversized pool instead of truncating it, which would keep
  // only whichever corner of the room happened to be scanned first.
  const out = [];
  const stride = all.length / maxCandidates;
  for (let i = 0; i < maxCandidates; i += 1) {
    out.push(all[Math.floor(i * stride)]);
  }
  return out;
}
