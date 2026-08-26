import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOccluderGeometry } from '../src/voxel-occluder-mesh.js';

const cell = (ix, iy, iz) => ({ ix, iy, iz });
const OPTS = { voxelSize: 0.1, origin: [0, 0, 0] };

test('an isolated cell keeps all six faces', () => {
  const g = buildOccluderGeometry([cell(0, 0, 0)], OPTS);
  assert.equal(g.triangleCount, 12); // 6 faces x 2
  assert.equal(g.vertexCount, 24);   // 6 faces x 4
});

// The whole point of culling: the shared face between two cells is interior
// and can never be seen, so drawing it is wasted depth work.
test('two face-adjacent cells drop the shared pair of faces', () => {
  const cells = [cell(0, 0, 0), cell(1, 0, 0)];
  assert.equal(buildOccluderGeometry(cells, OPTS).triangleCount, 20); // 10 faces
  assert.equal(
    buildOccluderGeometry(cells, { ...OPTS, cullHiddenFaces: false }).triangleCount,
    24, // 12 faces
  );
});

test('diagonal neighbours share no face and cull nothing', () => {
  const cells = [cell(0, 0, 0), cell(1, 1, 0)];
  assert.equal(buildOccluderGeometry(cells, OPTS).triangleCount, 24);
});

// Uint16 tops out at 65,535 and a real scan reaches ~92,000 vertices.
test('the index buffer is 32-bit', () => {
  const g = buildOccluderGeometry([cell(0, 0, 0)], OPTS);
  assert.ok(g.indices instanceof Uint32Array);
  assert.ok(g.positions instanceof Float32Array);
});

// Grid centres, not the cells' accumulated means: only grid-aligned boxes tile,
// and without tiling the culled interior faces become visible gaps.
test('each box is grid-aligned and spans exactly one voxel', () => {
  const g = buildOccluderGeometry([cell(0, 0, 0)], { voxelSize: 0.1, origin: [0, 0, 0] });
  const xs = [];
  for (let i = 0; i < g.positions.length; i += 3) xs.push(g.positions[i]);
  assert.ok(Math.abs(Math.min(...xs) - 0.0) < 1e-6);
  assert.ok(Math.abs(Math.max(...xs) - 0.1) < 1e-6);
});

test('a non-zero origin shifts the boxes', () => {
  const g = buildOccluderGeometry([cell(0, 0, 0)], { voxelSize: 0.1, origin: [1, 0, 0] });
  const xs = [];
  for (let i = 0; i < g.positions.length; i += 3) xs.push(g.positions[i]);
  assert.ok(Math.abs(Math.min(...xs) - 1.0) < 1e-6);
});

// Consistent winding matters because the material is FrontSide: a flipped face
// would be culled and leave a hole in the depth buffer.
test('every face winds outward', () => {
  const g = buildOccluderGeometry([cell(0, 0, 0)], OPTS);
  const p = (i) => [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]];
  const centre = [0.05, 0.05, 0.05];

  for (let t = 0; t < g.indices.length; t += 3) {
    const [a, b, c] = [p(g.indices[t]), p(g.indices[t + 1]), p(g.indices[t + 2])];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const out = [a[0] - centre[0], a[1] - centre[1], a[2] - centre[2]];
    const dot = n[0] * out[0] + n[1] * out[1] + n[2] * out[2];
    assert.ok(dot > 0, `triangle ${t / 3} winds inward`);
  }
});

test('empty input yields empty arrays rather than null', () => {
  const g = buildOccluderGeometry([], OPTS);
  assert.equal(g.triangleCount, 0);
  assert.equal(g.positions.length, 0);
  assert.equal(g.indices.length, 0);
});

test('a fully enclosed cell contributes nothing', () => {
  const cells = [cell(0, 0, 0)];
  for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
    cells.push(cell(dx, dy, dz));
  }
  const g = buildOccluderGeometry(cells, OPTS);
  // The centre cell is hidden on all six sides; each neighbour keeps 5 faces.
  assert.equal(g.triangleCount, 6 * 5 * 2);
});
