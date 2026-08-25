// Turns occupied voxels into a depth-only mesh. Pure: no three.js, no DOM.
//
// The point is to let the GPU do the occlusion. Once these boxes have written
// the room's geometry into the depth buffer, the z-test hides anything behind
// them for free, from every viewpoint, with no per-frame CPU cost — which is
// what makes a moving character stay correctly occluded.
//
// Boxes sit on GRID CENTRES, not on the cells' accumulated mean positions.
// Only grid-aligned boxes tile, and tiling is what makes hidden-face culling
// safe: a culled face is guaranteed to be covered by its neighbour. As a side
// effect the debug wireframe (drawn at mean positions) and this mesh disagree
// by up to half a voxel. That is expected, not a bug.

// Face definitions: outward normal, then the four corners in counter-clockwise
// order as seen from outside, expressed in unit-cube coordinates.
const FACES = [
  { n: [0, 0, 1], q: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // +Z
  { n: [0, 0, -1], q: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }, // -Z
  { n: [1, 0, 0], q: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // +X
  { n: [-1, 0, 0], q: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] }, // -X
  { n: [0, 1, 0], q: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, // +Y
  { n: [0, -1, 0], q: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }, // -Y
];

export function buildOccluderGeometry(cells, {
  voxelSize = 0.05,
  origin = [0, 0, 0],
  cullHiddenFaces = true,
} = {}) {
  const occupied = new Set();
  for (const c of cells) occupied.add(`${c.ix},${c.iy},${c.iz}`);

  // Count surviving faces first so the buffers are allocated exactly once.
  let faceCount = 0;
  for (const c of cells) {
    for (const face of FACES) {
      if (cullHiddenFaces
        && occupied.has(`${c.ix + face.n[0]},${c.iy + face.n[1]},${c.iz + face.n[2]}`)) continue;
      faceCount += 1;
    }
  }

  const positions = new Float32Array(faceCount * 4 * 3);
  const indices = new Uint32Array(faceCount * 6);
  let v = 0;
  let i = 0;

  for (const c of cells) {
    const x0 = origin[0] + c.ix * voxelSize;
    const y0 = origin[1] + c.iy * voxelSize;
    const z0 = origin[2] + c.iz * voxelSize;

    for (const face of FACES) {
      if (cullHiddenFaces
        && occupied.has(`${c.ix + face.n[0]},${c.iy + face.n[1]},${c.iz + face.n[2]}`)) continue;

      const base = v / 3;
      for (const [ux, uy, uz] of face.q) {
        positions[v] = x0 + ux * voxelSize;
        positions[v + 1] = y0 + uy * voxelSize;
        positions[v + 2] = z0 + uz * voxelSize;
        v += 3;
      }
      indices[i] = base;
      indices[i + 1] = base + 1;
      indices[i + 2] = base + 2;
      indices[i + 3] = base;
      indices[i + 4] = base + 2;
      indices[i + 5] = base + 3;
      i += 6;
    }
  }

  return {
    positions,
    indices,
    triangleCount: faceCount * 2,
    vertexCount: faceCount * 4,
  };
}
