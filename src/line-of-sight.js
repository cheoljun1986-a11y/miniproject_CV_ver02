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

// How much of a body at `to` the camera at `from` can actually see, 0..1.
//
// A single ray to the centre is the wrong question. A chair leg crossing the
// middle would zero out a character that is plainly visible, and a lucky gap
// would fully expose one that is behind a cupboard. Sampling several points
// spread across the body answers what the player sees instead.
//
// Samples sit on the vertical axis and on the horizontal axis perpendicular to
// the view direction, which is the silhouette the camera actually faces.
export function visibleFraction(grid, from, to, {
  bodyHeightM = 0.5,
  bodyRadiusM = 0.15,
  ...segmentOptions
} = {}) {
  if (!grid || !from || !to) return 1;

  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const planar = Math.hypot(dx, dz);
  // Sideways unit vector: perpendicular to the view direction on the ground.
  const sx = planar > 1e-6 ? -dz / planar : 1;
  const sz = planar > 1e-6 ? dx / planar : 0;

  const half = bodyHeightM / 2;
  const offsets = [
    [0, 0, 0],                                  // centre of mass
    [0, half * 0.8, 0],                         // head
    [0, -half * 0.8, 0],                        // feet
    [sx * bodyRadiusM, 0, sz * bodyRadiusM],    // left flank
    [-sx * bodyRadiusM, 0, -sz * bodyRadiusM],  // right flank
    [sx * bodyRadiusM * 0.7, half * 0.5, sz * bodyRadiusM * 0.7],
    [-sx * bodyRadiusM * 0.7, half * 0.5, -sz * bodyRadiusM * 0.7],
  ];

  let clear = 0;
  for (const [ox, oy, oz] of offsets) {
    const point = [to[0] + ox, to[1] + oy, to[2] + oz];
    if (!segmentBlocked(grid, from, point, segmentOptions)) clear += 1;
  }
  return clear / offsets.length;
}
