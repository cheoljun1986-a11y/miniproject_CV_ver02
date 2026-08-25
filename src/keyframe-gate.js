// Pose-gated keyframe selection for the voxel debug scan. Pure: no three.js,
// no DOM, no WebXR, so it can be unit-tested directly.
//
// Quaternions are [x, y, z, w]; positions are [x, y, z] in the XR local space.

// Angle between two orientations in degrees. |dot| makes it sign-agnostic,
// since q and -q describe the same orientation. Same formula as
// spatial-mapper.js:93-97, duplicated here rather than refactoring a module
// that already has tests riding on it.
export function quaternionAngleDeg(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  return (2 * Math.acos(Math.min(1, Math.abs(dot))) * 180) / Math.PI;
}

// True when the camera has moved or turned enough since the last accepted
// keyframe to be worth another depth capture. The first pose always qualifies.
export function isKeyframe({
  lastPose,
  position,
  quaternion,
  minTranslationM = 0.20,
  minRotationDeg = 15,
}) {
  if (!lastPose) return true;

  const dx = position[0] - lastPose.position[0];
  const dy = position[1] - lastPose.position[1];
  const dz = position[2] - lastPose.position[2];
  if (Math.hypot(dx, dy, dz) >= minTranslationM) return true;

  return quaternionAngleDeg(lastPose.quaternion, quaternion) >= minRotationDeg;
}

// Evaluate shouldCapture EVERY frame — it costs a handful of flops on a pose
// the render loop already computed. Polling it inside a time gate instead would
// widen the effective thresholds (at 90 deg/s a 200ms poll turns 15 deg into
// ~18 deg), which makes pose drift impossible to tell apart from a loose gate.
//
// minGapMs protects the frame budget only: because accept() records the pose at
// the instant of capture, the cooldown can delay a keyframe but never widens
// the pose delta that gets measured.
export class KeyframeGate {
  constructor({
    minTranslationM = 0.20,
    minRotationDeg = 15,
    maxKeyframes = 15,
    minGapMs = 250,
  } = {}) {
    this.minTranslationM = minTranslationM;
    this.minRotationDeg = minRotationDeg;
    this.maxKeyframes = maxKeyframes;
    this.minGapMs = minGapMs;
    this.lastPose = null;
    this.lastAcceptTime = -Infinity;
    this.count = 0;
  }

  shouldCapture(position, quaternion, time) {
    if (this.count >= this.maxKeyframes) return false;
    if (time - this.lastAcceptTime < this.minGapMs) return false;
    return isKeyframe({
      lastPose: this.lastPose,
      position,
      quaternion,
      minTranslationM: this.minTranslationM,
      minRotationDeg: this.minRotationDeg,
    });
  }

  accept(position, quaternion, time) {
    this.lastPose = {
      position: [position[0], position[1], position[2]],
      quaternion: [quaternion[0], quaternion[1], quaternion[2], quaternion[3]],
    };
    this.lastAcceptTime = time;
    this.count += 1;
  }

  getCount() {
    return this.count;
  }

  getLastPose() {
    return this.lastPose;
  }

  reset() {
    this.lastPose = null;
    this.lastAcceptTime = -Infinity;
    this.count = 0;
  }
}
