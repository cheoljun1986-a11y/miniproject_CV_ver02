// How much of Hachuping the player can see RIGHT NOW, measured against the
// live depth image — not against the frozen voxel map.
//
// Why this exists. The chase page used to cut the model per pixel with a
// full-screen depth mesh (80x60 vertices rebuilt every 66ms). At 2m a 20cm
// body spans only a handful of those cells, and single-cell depth noise — or
// the mesh lagging a fast camera turn — cut the whole character out of the
// frame with nothing real in front of it. Judging the body as ONE object at a
// few known points is robust where per-pixel cutting cannot be: one bad sample
// moves the answer by 1/7th instead of deleting the character.
//
// The measurement reuses the same seven-point silhouette as the map-grid test
// in line-of-sight.js, but asks the depth camera instead of the stored map, so
// it is honest about the CURRENT frame: real furniture blocks it, map drift
// does not.
//
// Everything here is pure math over matrices and a depth-lookup callback —
// no three.js, no WebXR types — so it unit-tests like line-of-sight.js does.

import { multiplyMat4Vec4 } from './depth-math.js';
import { bodySampleOffsets } from './line-of-sight.js';

// A surface must be at least this much CLOSER than the sample point to count
// as cover. ARCore depth error grows with range (several cm at 2m); with a
// small margin the noise reads as cover and the character flickers. 25cm is
// comfortably above the noise while still letting real walls and sofas occlude
// (they are almost always deeper than 25cm in front of a hiding spot).
export const LIVE_VISIBILITY_CLEARANCE_M = 0.25;

// Invert a rigid transform (rotation + translation, the shape of
// XRRigidTransform.matrix). Column-major, matching depth-math.js.
export function invertRigidMat4(m) {
  const tx = m[12];
  const ty = m[13];
  const tz = m[14];
  // Rotation block transposed in place; translation becomes -R^T * t, where
  // each component is the dot of an ORIGINAL column with t (columns of R are
  // rows of R^T).
  return [
    m[0], m[4], m[8], 0,
    m[1], m[5], m[9], 0,
    m[2], m[6], m[10], 0,
    -(m[0] * tx + m[1] * ty + m[2] * tz),
    -(m[4] * tx + m[5] * ty + m[6] * tz),
    -(m[8] * tx + m[9] * ty + m[10] * tz),
    1,
  ];
}

// World point -> the normalized view coordinate that sees it, plus its
// perpendicular view-Z distance. This is the exact inverse of
// depthSampleToWorld in depth-math.js: same top-left-origin (u, v) in [0, 1],
// same -Z-forward depth, so a coordinate produced here can be handed straight
// to getDepthInMeters.
//
// Returns null when the point is behind the camera or outside the frustum —
// off screen means "cannot measure", never "blocked".
export function projectToView(point, invViewMatrix, projectionMatrix) {
  const view = multiplyMat4Vec4(invViewMatrix, [point[0], point[1], point[2], 1]);
  if (!(view[2] < 0)) return null; // behind the camera
  const clip = multiplyMat4Vec4(projectionMatrix, view);
  if (clip[3] === 0) return null;
  const xNdc = clip[0] / clip[3];
  const yNdc = clip[1] / clip[3];
  const u = (xNdc + 1) / 2;
  const v = (1 - yNdc) / 2; // NDC y points up, view coords start top-left
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, depthM: -view[2] };
}

// Fraction of the body at `to`, seen from `from`, that the depth image says is
// unobstructed — 0..1, or null when no sample landed on screen (then the
// caller knows nothing new and should not pretend otherwise).
//
// readDepth(u, v) returns metres, or a non-positive/null value when the sensor
// has no answer there. No answer never blocks: missing depth is the same
// benefit of the doubt the map test gives unscanned space.
export function measuredVisibleFraction({ readDepth, invViewMatrix, projectionMatrix }, from, to, {
  bodyHeightM = 0.34,
  bodyRadiusM = 0.10,
  clearanceM = LIVE_VISIBILITY_CLEARANCE_M,
} = {}) {
  if (!readDepth || !from || !to) return null;

  const offsets = bodySampleOffsets(from, to, { bodyHeightM, bodyRadiusM });
  let sampled = 0;
  let clear = 0;
  for (const [ox, oy, oz] of offsets) {
    const projected = projectToView(
      [to[0] + ox, to[1] + oy, to[2] + oz],
      invViewMatrix,
      projectionMatrix,
    );
    if (!projected) continue;
    sampled += 1;
    const depth = readDepth(projected.u, projected.v);
    const blocked = depth > 0 && depth < projected.depthM - clearanceM;
    if (!blocked) clear += 1;
  }
  return sampled === 0 ? null : clear / sampled;
}

// Adapter over the shared CpuDepthFrameSource snapshot: run the measurement
// against the first view that can actually see the body. Mono AR has one view;
// the loop is for symmetry with how the occluder consumed the snapshot.
export function liveVisibleFraction(snapshot, from, to, options = {}) {
  for (const { view, depthInformation } of snapshot?.views ?? []) {
    const fraction = measuredVisibleFraction({
      readDepth: (u, v) => {
        try {
          return depthInformation.getDepthInMeters(u, v);
        } catch {
          return null; // a runtime may reject samples outside its valid region
        }
      },
      invViewMatrix: invertRigidMat4(view.transform.matrix),
      projectionMatrix: view.projectionMatrix,
    }, from, to, options);
    if (fraction !== null) return fraction;
  }
  return null;
}
