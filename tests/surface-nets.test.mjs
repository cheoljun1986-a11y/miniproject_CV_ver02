import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSurfaceNets, surfaceFromTsdf } from '../src/surface-nets.js';

const V = 0.05;

// Samples an analytic signed-distance function on a lattice, exactly the way
// TSDF fusion would have filled it in if every measurement were perfect.
function sampleField(fn, { lo = -6, hi = 6 } = {}) {
  const out = [];
  for (let ix = lo; ix <= hi; ix += 1) {
    for (let iy = lo; iy <= hi; iy += 1) {
      for (let iz = lo; iz <= hi; iz += 1) {
        const p = [(ix + 0.5) * V, (iy + 0.5) * V, (iz + 0.5) * V];
        out.push({ ix, iy, iz, value: fn(p) });
      }
    }
  }
  return out;
}

function vertices(mesh) {
  const out = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    out.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
  }
  return out;
}

// The claim TSDF is bought for: the surface is located between voxel centres,
// not snapped to them. A plane deliberately placed off-lattice would land on a
// 5cm staircase if we drew voxels; here it must come out flat.
test('a slanted plane is reconstructed to well under one voxel', () => {
  // Plane through an awkward offset, normal not axis-aligned.
  const n = [0.6, 0.8, 0]; // unit
  const d = 0.017;
  const mesh = buildSurfaceNets(sampleField((p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d), { voxelSize: V });

  assert.ok(mesh.triangleCount > 100, `got ${mesh.triangleCount} triangles`);
  let worst = 0;
  let sum = 0;
  const vs = vertices(mesh);
  for (const p of vs) {
    const dist = Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d);
    worst = Math.max(worst, dist);
    sum += dist * dist;
  }
  const rms = Math.sqrt(sum / vs.length);
  // Voxel-centre rendering would sit up to 2.5cm off; this must be far better.
  assert.ok(rms < 0.004, `RMS ${(rms * 1000).toFixed(1)}mm should be a few mm`);
  assert.ok(worst < 0.012, `worst ${(worst * 1000).toFixed(1)}mm`);
});

test('a sphere keeps its radius rather than its voxelisation', () => {
  const R = 0.2;
  const mesh = buildSurfaceNets(sampleField((p) => Math.hypot(p[0], p[1], p[2]) - R, { lo: -8, hi: 8 }), { voxelSize: V });
  const vs = vertices(mesh);
  assert.ok(vs.length > 200);
  let worst = 0;
  for (const p of vs) worst = Math.max(worst, Math.abs(Math.hypot(p[0], p[1], p[2]) - R));
  assert.ok(worst < 0.008, `worst radial error ${(worst * 1000).toFixed(1)}mm`);
});

test('a field with no sign change produces no surface', () => {
  const all = sampleField(() => 0.4);
  assert.equal(buildSurfaceNets(all, { voxelSize: V }).triangleCount, 0);
  const none = sampleField(() => -0.4);
  assert.equal(buildSurfaceNets(none, { voxelSize: V }).triangleCount, 0);
});

// A hole in the scan must stay a hole. Guessing "free space" for missing
// samples would seal it with an invented wall and hide the very gap the
// diagnostic exists to reveal.
test('cubes touching a missing sample are skipped, so gaps stay gaps', () => {
  const full = sampleField((p) => p[1] - 0.017);
  const punched = full.filter((s) => !(s.ix === 0 && s.iz === 0));
  const a = buildSurfaceNets(full, { voxelSize: V });
  const b = buildSurfaceNets(punched, { voxelSize: V });
  assert.ok(b.triangleCount > 0);
  assert.ok(b.triangleCount < a.triangleCount, 'the hole costs triangles');
});

test('triangle winding puts the normal on the free-space side', () => {
  // Flat floor at y = 0.017: free space (positive) above it.
  const mesh = buildSurfaceNets(sampleField((p) => p[1] - 0.017), { voxelSize: V });
  const P = mesh.positions;
  let up = 0;
  let down = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1 = [P[b * 3] - ax, P[b * 3 + 1] - ay, P[b * 3 + 2] - az];
    const e2 = [P[c * 3] - ax, P[c * 3 + 1] - ay, P[c * 3 + 2] - az];
    const ny = e1[2] * e2[0] - e1[0] * e2[2]; // y component of e1 x e2
    if (ny > 0) up += 1; else if (ny < 0) down += 1;
  }
  assert.ok(up > 0);
  assert.equal(down, 0, 'every triangle faces the same way');
});

test('surfaceFromTsdf reads a grid and honours the evidence threshold', () => {
  const cells = sampleField((p) => p[1] - 0.017)
    .map((s) => ({ ...s, tsdf: s.value, weight: s.iy === 0 ? 1 : 5 }));
  const grid = { voxelSize: V, origin: [0, 0, 0], getCells: () => cells };

  const loose = surfaceFromTsdf(grid, { minWeight: 1 });
  const strict = surfaceFromTsdf(grid, { minWeight: 3 });
  assert.ok(loose.triangleCount > 0);
  // Dropping the single-look layer removes the cubes that needed it.
  assert.ok(strict.triangleCount < loose.triangleCount);
});
