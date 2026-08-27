// Pure RANSAC fit of the dominant near-horizontal plane (the floor) to a point
// cloud, modelled as a height field y = a*x + b*z + c. No three.js dependency so
// it can be unit-tested directly.
//
// A height field cannot represent a vertical wall — a wall stacks many y values
// over one (x, z) footprint — so walls drop out for free. A slope cap
// (maxTiltDeg) rejects steep surfaces, and RANSAC's inlier vote rejects
// floating-pixel noise. The hypothesis with the most inliers wins, which in an
// ordinary room is the floor: the single largest flat area.

// Height-field plane through three points, or null if they are collinear in xz.
function planeFromThree(p1, p2, p3) {
  const [x1, y1, z1] = p1;
  const [x2, y2, z2] = p2;
  const [x3, y3, z3] = p3;
  const det = (x1 - x3) * (z2 - z3) - (z1 - z3) * (x2 - x3);
  if (Math.abs(det) < 1e-9) return null;
  const a = ((y1 - y3) * (z2 - z3) - (z1 - z3) * (y2 - y3)) / det;
  const b = ((x1 - x3) * (y2 - y3) - (y1 - y3) * (x2 - x3)) / det;
  const c = y1 - a * x1 - b * z1;
  return { a, b, c };
}

function det3(m) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function solve3(M, v) {
  const det = det3(M);
  if (Math.abs(det) < 1e-12) return null;
  const col = (i) => [
    [i === 0 ? v[0] : M[0][0], i === 1 ? v[0] : M[0][1], i === 2 ? v[0] : M[0][2]],
    [i === 0 ? v[1] : M[1][0], i === 1 ? v[1] : M[1][1], i === 2 ? v[1] : M[1][2]],
    [i === 0 ? v[2] : M[2][0], i === 1 ? v[2] : M[2][1], i === 2 ? v[2] : M[2][2]],
  ];
  return { a: det3(col(0)) / det, b: det3(col(1)) / det, c: det3(col(2)) / det };
}

// Least-squares height-field fit over the inlier set: minimise
// Σ (a*xi + b*zi + c − yi)² via the normal equations.
function refit(points, inlierIdx) {
  let Sxx = 0; let Sxz = 0; let Sx = 0; let Szz = 0; let Sz = 0;
  let n = 0; let Sxy = 0; let Szy = 0; let Sy = 0;
  for (const i of inlierIdx) {
    const [x, y, z] = points[i];
    Sxx += x * x; Sxz += x * z; Sx += x;
    Szz += z * z; Sz += z; n += 1;
    Sxy += x * y; Szy += z * y; Sy += y;
  }
  return solve3(
    [[Sxx, Sxz, Sx], [Sxz, Szz, Sz], [Sx, Sz, n]],
    [Sxy, Szy, Sy],
  );
}

function countInliers(points, { a, b, c }, threshold) {
  let count = 0;
  for (let p = 0; p < points.length; p += 1) {
    const [x, y, z] = points[p];
    if (Math.abs(y - (a * x + b * z + c)) <= threshold) count += 1;
  }
  return count;
}

function makePlane({ a, b, c }, inlierCount) {
  return {
    a,
    b,
    c,
    inlierCount,
    slope: Math.hypot(a, b),
    heightAt(x, z) { return a * x + b * z + c; },
  };
}

// Fit the floor plane. Returns { a, b, c, inlierCount, slope, heightAt(x, z) }
// or null when no plane clears minInliers / the tilt cap.
//
// The floor is the LOWEST substantial horizontal surface, not the one with the
// most points — a desk or a bed can out-vote a floor whose depth samples are
// sparse. So among near-horizontal hypotheses that clear minInliers AND hold at
// least keepFraction of the best hypothesis' inliers (enough to be a real
// surface, not sub-floor noise), the lowest one wins. select: 'dominant' keeps
// the classic most-inliers choice for callers that want it.
export function fitFloorPlane(points, {
  iterations = 200,
  distanceThreshold = 0.05,
  maxTiltDeg = 20,
  minInliers = 40,
  keepFraction = 0.35,
  select = 'lowest',
  rng = Math.random,
} = {}) {
  if (!points || points.length < 3) return null;
  const maxSlope = Math.tan((maxTiltDeg * Math.PI) / 180);
  const n = points.length;

  // Reference point for comparing plane heights fairly under a slight tilt.
  let rx = 0; let rz = 0;
  for (const p of points) { rx += p[0]; rz += p[2]; }
  rx /= n; rz /= n;
  const heightRef = ({ a, b, c }) => a * rx + b * rz + c;

  const candidates = [];
  for (let iter = 0; iter < iterations; iter += 1) {
    const i = (rng() * n) | 0;
    const j = (rng() * n) | 0;
    const k = (rng() * n) | 0;
    if (i === j || j === k || i === k) continue;
    const plane = planeFromThree(points[i], points[j], points[k]);
    if (!plane) continue;
    if (Math.hypot(plane.a, plane.b) > maxSlope) continue;
    const count = countInliers(points, plane, distanceThreshold);
    if (count >= minInliers) candidates.push({ plane, count });
  }
  if (!candidates.length) return null;

  const maxCount = candidates.reduce((m, c) => Math.max(m, c.count), 0);
  const keep = Math.max(minInliers, maxCount * keepFraction);
  const pool = candidates.filter((c) => c.count >= keep);
  const chosen = select === 'dominant'
    ? pool.reduce((a, b) => (b.count > a.count ? b : a))
    : pool.reduce((a, b) => (heightRef(b.plane) < heightRef(a.plane) ? b : a));

  // Refit on the chosen hypothesis' inliers for a sub-sample-accurate plane.
  const best = chosen.plane;
  const inlierIdx = [];
  for (let p = 0; p < n; p += 1) {
    const [x, y, z] = points[p];
    if (Math.abs(y - (best.a * x + best.b * z + best.c)) <= distanceThreshold) inlierIdx.push(p);
  }
  const refined = refit(points, inlierIdx);
  if (!refined || Math.hypot(refined.a, refined.b) > maxSlope) {
    // Degenerate or the refit drifted past the tilt cap: keep the hypothesis.
    return makePlane(best, inlierIdx.length);
  }
  return makePlane(refined, countInliers(points, refined, distanceThreshold));
}
