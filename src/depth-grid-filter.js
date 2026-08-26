// Per-pixel filters applied to a stored keyframe depth grid. Pure: no three.js,
// no DOM, no WebXR, so every threshold can be re-tuned offline against the same
// captured scan instead of requiring a fresh 20-second walk.
//
// Grids are row-major, indexed row * width + col.

export function isDepthMeasured(depth) {
  return Number.isFinite(depth) && depth > 0;
}

export function isDepthInRange(depth, nearM, farM) {
  return isDepthMeasured(depth) && depth >= nearM && depth <= farM;
}

// Flying-pixel rejection: a sample sitting on an object boundary interpolates
// between the near and far surface and unprojects into empty air. Any single
// neighbour past the jump limit is enough to discard it.
//
// A non-positive maxJumpM disables the check, which is how the panel expresses
// "gradient off" with one slider and no extra checkbox.
export function neighborGradientOk(
  depths,
  width,
  height,
  col,
  row,
  maxJumpM,
  { rejectOnMissingNeighbor = false } = {},
) {
  if (!(maxJumpM > 0)) return true;

  const center = depths[row * width + col];
  if (!isDepthMeasured(center)) return false;

  const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dc, dr] of offsets) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;

    const neighbor = depths[nr * width + nc];
    if (!isDepthMeasured(neighbor)) {
      // Depth holes are everywhere in ARCore output. Treating them as a
      // rejection kills most of the frame and reads as "depth is broken".
      if (rejectOnMissingNeighbor) return false;
      continue;
    }
    if (Math.abs(neighbor - center) > maxJumpM) return false;
  }
  return true;
}

// Walks the grid once, calling visit(col, row, depth) for surviving samples.
// The four counters always sum to total, so the HUD can show exactly where the
// samples went.
export function filterDepthGrid(
  { depths, width, height },
  { nearM = 0.3, farM = 5.0, gradientMaxJumpM = 0.10, rejectOnMissingNeighbor = false } = {},
  visit,
) {
  const stats = {
    total: width * height,
    rejectedZero: 0,
    rejectedRange: 0,
    rejectedGradient: 0,
    accepted: 0,
  };

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const depth = depths[row * width + col];
      if (!isDepthMeasured(depth)) {
        stats.rejectedZero += 1;
        continue;
      }
      if (!isDepthInRange(depth, nearM, farM)) {
        stats.rejectedRange += 1;
        continue;
      }
      if (!neighborGradientOk(depths, width, height, col, row, gradientMaxJumpM, {
        rejectOnMissingNeighbor,
      })) {
        stats.rejectedGradient += 1;
        continue;
      }
      stats.accepted += 1;
      visit(col, row, depth);
    }
  }
  return stats;
}
