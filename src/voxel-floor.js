// Ground-plane detection over the voxel cells. Pure: no three.js, no DOM.
//
// spec 4-1 method A (Y histogram mode), hardened against the failure it names:
// "what if the floor is not the modal Y". On a desk-scale scan the desk surface
// can easily out-populate the floor, so the mode is searched only in a window
// anchored to the bottom of the distribution.

const DEFAULTS = {
  binM: 0.05,
  // A desk sits ~0.70m above the floor — five times outside this window.
  searchSpanM: 0.35,
  // Percentile, not minimum: flying pixels below the floor would drag the
  // window down and anchor it to noise. 5% rather than 1% because the real
  // scans detect the floor identically at 1/3/5/10%, so the value is set by
  // how much sub-floor noise it must survive — at 1% a 5% noise band captures
  // the window and the detection collapses onto the noise.
  lowPercentile: 0.05,
};

export function detectFloorY(cells, options = {}) {
  const { binM, searchSpanM, lowPercentile } = { ...DEFAULTS, ...options };
  if (!cells.length) return null;

  const ys = cells.map((c) => c.iy * binM).sort((a, b) => a - b);
  const low = ys[Math.min(ys.length - 1, Math.floor(ys.length * lowPercentile))];

  const histogram = new Map();
  for (const cell of cells) {
    const y = cell.iy * binM;
    if (y < low || y > low + searchSpanM) continue;
    histogram.set(cell.iy, (histogram.get(cell.iy) ?? 0) + 1);
  }
  if (!histogram.size) return null;

  let peakIy = null;
  let peakCount = -1;
  for (const [iy, count] of histogram) {
    if (count > peakCount) { peakCount = count; peakIy = iy; }
  }

  // Confidence is the peak against its taller shoulder. A real plane is a spike
  // in one bin; a smooth slope has shoulders as tall as the peak.
  const neighborCount = Math.max(
    histogram.get(peakIy - 1) ?? 0,
    histogram.get(peakIy + 1) ?? 0,
  );
  const confidence = neighborCount > 0 ? peakCount / neighborCount : Infinity;

  return { floorY: peakIy * binM, peakCount, neighborCount, confidence, binM };
}

// Cuts everything at or below the plane rather than a symmetric band. Voxels
// under the floor are always noise, and a symmetric band leaves a residual film
// that connects otherwise separate objects into one blob.
export function removeFloorCells(cells, { floorY, bandM = 0.08, binM = 0.05 } = {}) {
  if (floorY === null || floorY === undefined) return { kept: cells, removedCount: 0 };

  const cutoff = floorY + bandM;
  const kept = cells.filter((c) => c.iy * binM > cutoff);
  return { kept, removedCount: cells.length - kept.length };
}
