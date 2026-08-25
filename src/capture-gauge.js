// Capture rule for the chase: keep Hachuping close and on screen and the gauge
// fills. Both conditions must hold at once.
//
// An earlier version also required holding the SCAN button. On a phone that
// turned into a long-press on a DOM element, which Android answers with the
// text-selection toolbar, so the requirement was dropped; requireHold keeps the
// old behaviour available for tests.
//
// The gauge decays instead of resetting. AR range readings jitter and the
// target briefly disappears behind furniture, and restarting a five second
// hold every time that happens makes the game feel broken rather than hard.

export const CAPTURE_RADIUS_M = 1.2;
export const CAPTURE_ANGLE_DEG = 20;
export const CAPTURE_SECONDS = 5;
export const CAPTURE_DECAY_PER_S = 0.12;

export function angleToTargetDeg(viewerForward, viewerPosition, targetPosition) {
  const dx = targetPosition[0] - viewerPosition[0];
  const dy = targetPosition[1] - viewerPosition[1];
  const dz = targetPosition[2] - viewerPosition[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) return 0;
  const dot = (viewerForward[0] * dx + viewerForward[1] * dy + viewerForward[2] * dz) / distance;
  return Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
}

// Rotate a world vector into the viewer's own frame (-Z forward, +X right,
// +Y up) by applying the inverse of the viewer orientation.
export function directionInViewSpace([qx, qy, qz, qw], viewerPosition, targetPosition) {
  const v = [
    targetPosition[0] - viewerPosition[0],
    targetPosition[1] - viewerPosition[1],
    targetPosition[2] - viewerPosition[2],
  ];
  // Conjugate rotates the other way.
  const cx = -qx;
  const cy = -qy;
  const cz = -qz;
  const t = [
    2 * (cy * v[2] - cz * v[1]),
    2 * (cz * v[0] - cx * v[2]),
    2 * (cx * v[1] - cy * v[0]),
  ];
  return [
    v[0] + qw * t[0] + (cy * t[2] - cz * t[1]),
    v[1] + qw * t[1] + (cz * t[0] - cx * t[2]),
    v[2] + qw * t[2] + (cx * t[1] - cy * t[0]),
  ];
}

// Rotation for an arrow glyph that points up when the target is above centre.
export function screenAngleFromViewDirection([x, y]) {
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return 0;
  return Math.atan2(x, y);
}

export class CaptureGauge {
  constructor({
    radius = CAPTURE_RADIUS_M,
    angleDeg = CAPTURE_ANGLE_DEG,
    seconds = CAPTURE_SECONDS,
    decayPerSecond = CAPTURE_DECAY_PER_S,
    requireHold = false,
  } = {}) {
    this.radius = radius;
    this.angleDeg = angleDeg;
    this.fillPerSecond = 1 / seconds;
    this.decayPerSecond = decayPerSecond;
    this.requireHold = requireHold;
    this.reset();
  }

  reset() {
    this.value = 0;
    this.captured = false;
    this.inRange = false;
    this.onScreen = false;
    this.holding = !this.requireHold;
  }

  // dt in seconds. Returns the current state; `captured` latches until reset.
  update(dt, { distance = Infinity, angleDeg = 180, holding = false } = {}) {
    this.inRange = distance <= this.radius;
    this.onScreen = angleDeg <= this.angleDeg;
    this.holding = this.requireHold ? Boolean(holding) : true;

    if (this.captured) return this.getState();

    const filling = this.inRange && this.onScreen && this.holding;
    const step = filling ? this.fillPerSecond * dt : -this.decayPerSecond * dt;
    this.value = Math.min(1, Math.max(0, this.value + step));
    if (this.value >= 1) this.captured = true;
    return this.getState();
  }

  // Hachuping tires as the lock builds, so the last stretch of a chase
  // converges instead of running forever.
  speedMultiplier() {
    if (this.value >= 0.7) return 0.45;
    if (this.value >= 0.4) return 0.7;
    return 1;
  }

  getState() {
    return {
      value: this.value,
      captured: this.captured,
      inRange: this.inRange,
      onScreen: this.onScreen,
      holding: this.holding,
      filling: this.inRange && this.onScreen && this.holding && !this.captured,
    };
  }

  // Short reason the player can act on, most blocking condition first.
  hint() {
    if (this.captured) return '검거 성공';
    if (!this.inRange) return '더 가까이';
    if (!this.onScreen) return '화면 중앙에 맞추세요';
    if (!this.holding) return 'SCAN 을 누르고 계세요';
    return '검거 중';
  }
}
