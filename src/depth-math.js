// Pure math for turning a WebXR CPU depth sample into a world-space point.
// No three.js dependency so it can be unit-tested directly.
//
// Matrices are column-major 16-element arrays, matching WebXR's
// XRView.projectionMatrix and XRRigidTransform.matrix (and three's Matrix4).

// Multiply a column-major mat4 by a vec4. Element (row i, col j) is m[i + 4*j].
export function multiplyMat4Vec4(m, [x, y, z, w]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

// Reconstruct the world-space point seen at normalized view coordinate (u, v)
// — origin upper-left, both in [0, 1], the same convention getDepthInMeters
// uses — given the metric depth there (perpendicular distance along the view's
// -Z axis, ARCore convention).
//
// invProjection: inverse of the view's projection matrix (clip -> view).
// viewMatrix:    the view's transform matrix (view -> world in the ref space).
// Returns [x, y, z] in world space, or null when the sample has no usable depth.
export function depthSampleToWorld(u, v, depth, invProjection, viewMatrix) {
  if (!(depth > 0)) return null;

  // Normalized view coords -> normalized device coords. Flip v because view
  // coords start at the top-left while NDC y points up.
  const xNdc = u * 2 - 1;
  const yNdc = (1 - v) * 2 - 1;

  // Unproject the near-plane clip point to a view-space ray from the camera.
  const ray = multiplyMat4Vec4(invProjection, [xNdc, yNdc, -1, 1]);
  if (ray[3] === 0) return null;
  const vx = ray[0] / ray[3];
  const vy = ray[1] / ray[3];
  const vz = ray[2] / ray[3];
  if (!(vz < 0)) return null; // must be in front of the camera

  // Scale the ray so its perpendicular (view-Z) distance equals the depth.
  const scale = depth / -vz;
  const world = multiplyMat4Vec4(viewMatrix, [vx * scale, vy * scale, vz * scale, 1]);
  return [world[0], world[1], world[2]];
}

// Quantize a point to a voxel cell key, used to deduplicate accumulated points.
export function voxelKey(x, y, z, size) {
  return `${Math.floor(x / size)},${Math.floor(y / size)},${Math.floor(z / size)}`;
}
