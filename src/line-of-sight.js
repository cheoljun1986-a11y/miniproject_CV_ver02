// Is the straight line between two world points interrupted by something the
// traversal grid believes is solid?
//
// Used by the capture rule: aiming at where Hachuping *is* should not fill the
// gauge when a scanned obstacle sits in between — with the voxel occluder on,
// the player would be staring at a sofa while the HUD claims a capture is in
// progress.
//
// The march samples the segment every stepM and asks the grid whether that
// point falls inside an occupied slab. Both ends get a clearance band:
//  - startClearM keeps the player's own body / phone out of the test,
//  - endClearM keeps the surface Hachuping stands on (and the furniture edge
//    it hugs) from counting as cover for itself.
//
// Pure function over TraversalGrid — no three.js, unit-testable.

export function segmentBlocked(grid, from, to, {
  stepM = 0.1,
  startClearM = 0.3,
  endClearM = 0.3,
} = {}) {
  if (!grid || !from || !to) return false;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  if (length <= startClearM + endClearM) return false;

  for (let d = startClearM; d <= length - endClearM; d += stepM) {
    const t = d / length;
    const x = from[0] + dx * t;
    const y = from[1] + dy * t;
    const z = from[2] + dz * t;
    const cell = grid.getCell(grid.cellX(x), grid.cellZ(z));
    if (!cell) continue; // unscanned space never blocks — benefit of the doubt
    if (grid.hasSlab(cell, grid.slabOf(y))) return true;
  }
  return false;
}
