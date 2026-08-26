// Pure framing math for the operator camera. No three.js dependency so it can
// be unit-tested directly.
//
// The reconstruction grows around wherever the session started, so a camera
// parked at a fixed point can end up looking at empty space once the player
// walks away. framePoints turns the reconstructed points into the point to look
// at and how far back the camera has to sit to contain them.

// Smallest half-extent to frame, so a map of one or two voxels does not put the
// camera inside the geometry.
const MIN_RADIUS_M = 0.6;

// Leaves margin around the reconstruction instead of touching the frame edge.
const MARGIN = 1.25;

export function framePoints(points, fovDegrees) {
  if (!points.length) return null;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  }

  const target = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
  const radius = Math.max(
    MIN_RADIUS_M,
    Math.hypot(...[0, 1, 2].map((axis) => (max[axis] - min[axis]) / 2)),
  );

  // Distance at which a sphere of this radius fills the vertical field of view.
  const halfFov = (fovDegrees * Math.PI) / 180 / 2;
  return { target, distance: (radius / Math.sin(halfFov)) * MARGIN };
}
