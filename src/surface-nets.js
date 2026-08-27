// Extracts the zero-crossing surface of a TSDF field as a triangle mesh.
// Pure: no three.js, no DOM, so the same code runs in the viewer, in a test,
// and (if it ever earns its place) on the phone.
//
// Why this exists: fusing signed distances buys sub-voxel accuracy — a voxel
// holding +0.3 next to one holding -0.2 says the surface passes 60% of the way
// between their centres. Drawing the voxels themselves throws that away and
// gives back the 5cm staircase hit counting produced. This reads the crossing
// instead, so a slanted wall comes out slanted rather than stepped.
//
// Naive Surface Nets rather than Marching Cubes: one vertex per cell that
// straddles the surface, placed at the average of its edge crossings, then
// quads across every crossing edge. It needs no 256-entry case table (the
// classic source of silent typos), always produces a manifold, and the vertex
// averaging is itself a mild smoother. Marching Cubes reproduces sharp corners
// better, which a room scan does not have to begin with.
//
// Convention: negative is inside the surface, positive is free space — the
// same sign TsdfGrid stores. Corner samples are voxel CENTRES, so a cube of
// this dual grid spans the gap between eight neighbouring centres.

// Corner c of a cube = (c & 1, (c >> 1) & 1, (c >> 2) & 1) offsets.
const CORNER = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

// The 12 cube edges as corner index pairs.
const EDGE = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

// The four cubes sharing a lattice edge, as offsets from the edge's low corner.
// The loop order matters (it must go around the edge, not criss-cross it); the
// FACING is fixed afterwards from the field gradient, so a per-axis winding
// convention — the easy thing to get silently backwards — is never relied on.
const QUAD_CUBES = [
  [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]], // x edge
  [[-1, 0, -1], [0, 0, -1], [0, 0, 0], [-1, 0, 0]], // y edge
  [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]], // z edge
];

const key = (ix, iy, iz) => `${ix},${iy},${iz}`;

// One component of the normal of triangle (a, b, c), without building vectors.
function faceNormalComponent(positions, a, b, c, axis) {
  const ax = positions[a * 3]; const ay = positions[a * 3 + 1]; const az = positions[a * 3 + 2];
  const ux = positions[b * 3] - ax; const uy = positions[b * 3 + 1] - ay; const uz = positions[b * 3 + 2] - az;
  const vx = positions[c * 3] - ax; const vy = positions[c * 3 + 1] - ay; const vz = positions[c * 3 + 2] - az;
  if (axis === 0) return uy * vz - uz * vy;
  if (axis === 1) return uz * vx - ux * vz;
  return ux * vy - uy * vx;
}

// samples: iterable of { ix, iy, iz, value } — one per voxel centre.
// Returns flat arrays ready for a BufferGeometry, plus the counts.
export function buildSurfaceNets(samples, {
  voxelSize = 0.05,
  origin = [0, 0, 0],
  iso = 0,
  // Cubes touching a missing sample are skipped rather than guessed. Filling
  // them with "free space" would seal every hole in the scan with an invented
  // wall, which is precisely the error this whole pipeline is trying to see.
  maxVertices = 400000,
} = {}) {
  const field = new Map();
  for (const s of samples) field.set(key(s.ix, s.iy, s.iz), s.value);

  const positions = [];
  const cubeVertex = new Map(); // cube min-corner key -> vertex index

  // Pass 1: one vertex per straddling cube, at the mean of its edge crossings.
  for (const k of field.keys()) {
    const [ix, iy, iz] = k.split(',').map(Number);
    const corners = new Array(8);
    let missing = false;
    let negatives = 0;
    for (let c = 0; c < 8; c += 1) {
      const [dx, dy, dz] = CORNER[c];
      const v = field.get(key(ix + dx, iy + dy, iz + dz));
      if (v === undefined) { missing = true; break; }
      corners[c] = v - iso;
      if (corners[c] < 0) negatives += 1;
    }
    if (missing || negatives === 0 || negatives === 8) continue;

    let sx = 0; let sy = 0; let sz = 0; let crossings = 0;
    for (const [a, b] of EDGE) {
      const va = corners[a];
      const vb = corners[b];
      if ((va < 0) === (vb < 0)) continue;
      // Where along the edge the field passes zero.
      const t = va / (va - vb);
      const [ax, ay, az] = CORNER[a];
      const [bx, by, bz] = CORNER[b];
      sx += ax + (bx - ax) * t;
      sy += ay + (by - ay) * t;
      sz += az + (bz - az) * t;
      crossings += 1;
    }
    if (!crossings) continue;
    if (positions.length / 3 >= maxVertices) break;

    // Cube-local [0,1] coordinates back to world, remembering that corner
    // (ix,iy,iz) is a voxel CENTRE, not a voxel corner.
    cubeVertex.set(k, positions.length / 3);
    positions.push(
      origin[0] + (ix + 0.5 + sx / crossings) * voxelSize,
      origin[1] + (iy + 0.5 + sy / crossings) * voxelSize,
      origin[2] + (iz + 0.5 + sz / crossings) * voxelSize,
    );
  }

  // Pass 2: a quad for every lattice edge the surface crosses, joining the
  // vertices of the four cubes around it.
  const indices = [];
  for (const k of field.keys()) {
    const [ix, iy, iz] = k.split(',').map(Number);
    const v0 = field.get(k) - iso;
    for (let axis = 0; axis < 3; axis += 1) {
      const nx = ix + (axis === 0 ? 1 : 0);
      const ny = iy + (axis === 1 ? 1 : 0);
      const nz = iz + (axis === 2 ? 1 : 0);
      const v1raw = field.get(key(nx, ny, nz));
      if (v1raw === undefined) continue;
      const v1 = v1raw - iso;
      if ((v0 < 0) === (v1 < 0)) continue;

      const quad = [];
      let complete = true;
      for (const [dx, dy, dz] of QUAD_CUBES[axis]) {
        const index = cubeVertex.get(key(ix + dx, iy + dy, iz + dz));
        if (index === undefined) { complete = false; break; }
        quad.push(index);
      }
      if (!complete) continue;

      // Face the positive (free space) side. Along this edge the field runs
      // from v0 to v1, so free space lies toward +axis when v0 is the negative
      // end and toward -axis otherwise. Compare that with the triangle's own
      // normal and reverse the loop if they disagree.
      const [a, b, c, d] = quad;
      const nAxis = faceNormalComponent(positions, a, b, c, axis);
      const wantPositive = v0 < 0;
      const flip = wantPositive ? nAxis < 0 : nAxis > 0;
      if (flip) indices.push(d, c, b, d, b, a);
      else indices.push(a, b, c, a, c, d);
    }
  }

  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

// Convenience wrapper for a TsdfGrid: only cells with enough evidence take
// part, so a single-look voxel cannot drag the surface toward itself.
export function surfaceFromTsdf(grid, { minWeight = 1, ...options } = {}) {
  const samples = [];
  for (const cell of grid.getCells()) {
    if (cell.weight < minWeight) continue;
    samples.push({ ix: cell.ix, iy: cell.iy, iz: cell.iz, value: cell.tsdf });
  }
  return buildSurfaceNets(samples, {
    voxelSize: grid.voxelSize,
    origin: grid.origin,
    ...options,
  });
}
