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

// Raised from 1.2m: on device you had to be almost on top of Hachuping before
// the gauge moved, which turned the chase into a shoving match. 2m is the
// range the designer specified — an earlier commit shipped 3.0 without that
// instruction on record, which this corrects.
export const CAPTURE_RADIUS_M = 2.0;
export const CAPTURE_ANGLE_DEG = 20;
export const CAPTURE_SECONDS = 5;
export const CAPTURE_DECAY_PER_S = 0.12;
// Visibility is graded, not a switch. Partly seeing the character should still
// count — a chair leg across the middle is not the same as a wall.
//   at or above FULL  → fills at the normal rate
//   between the two   → fills proportionally slower
//   at or below HIDDEN → fills at the slow floor below
export const CAPTURE_VISIBLE_FULL = 0.6;
export const CAPTURE_VISIBLE_HIDDEN = 0.15;
// Even a fully blocked sight line still fills, just slowly. Visibility is a
// vote of seven body points against the live depth image, and at 2m a 20cm body
// spans only a handful of depth cells — a bad patch can read as fully covered
// with nothing really in front of it. Refusing to fill at all made those false
// positives feel like the game had frozen.
export const CAPTURE_HIDDEN_FILL_SCALE = 0.25;
// Depth noise makes a sample flicker between blocked and clear. Easing the
// measured value over roughly a quarter second absorbs that without the gauge
// visibly lurching.
export const CAPTURE_VISIBILITY_EASE_PER_S = 4;

// The arrow that points offscreen used one threshold for both directions, so a
// target hovering near it blinked every frame. Turn on later than off.
export const ARROW_SHOW_ANGLE_DEG = 40;
export const ARROW_HIDE_ANGLE_DEG = 30;

// Stateful edge so callers do not each reinvent the debounce.
export function makeArrowGate({
  showDeg = ARROW_SHOW_ANGLE_DEG,
  hideDeg = ARROW_HIDE_ANGLE_DEG,
} = {}) {
  let shown = false;
  return (angleDeg) => {
    if (shown ? angleDeg <= hideDeg : angleDeg >= showDeg) shown = !shown;
    return shown;
  };
}

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
    visibleFull = CAPTURE_VISIBLE_FULL,
    visibleHidden = CAPTURE_VISIBLE_HIDDEN,
    visibilityEasePerSecond = CAPTURE_VISIBILITY_EASE_PER_S,
    hiddenFillScale = CAPTURE_HIDDEN_FILL_SCALE,
  } = {}) {
    this.radius = radius;
    this.angleDeg = angleDeg;
    this.fillPerSecond = 1 / seconds;
    this.decayPerSecond = decayPerSecond;
    this.requireHold = requireHold;
    this.visibleFull = visibleFull;
    this.visibleHidden = visibleHidden;
    this.visibilityEasePerSecond = visibilityEasePerSecond;
    this.hiddenFillScale = hiddenFillScale;
    this.reset();
  }

  reset() {
    this.value = 0;
    this.captured = false;
    this.inRange = false;
    this.onScreen = false;
    this.holding = !this.requireHold;
    this.visibility = 1;
    this.visibleScale = 1;
    this.visible = true;
  }

  // Fraction of the fill rate this much visibility earns.
  scaleForVisibility(visibility) {
    const span = this.visibleFull - this.visibleHidden;
    const graded = span <= 0
      ? (visibility > this.visibleHidden ? 1 : 0)
      : Math.min(1, Math.max(0, (visibility - this.visibleHidden) / span));
    // Never returns 0: hidden is slow, not impossible.
    return Math.max(this.hiddenFillScale, graded);
  }

  // dt in seconds. Returns the current state; `captured` latches until reset.
  //
  // `visibility` is how much of the character the terrain leaves in view, 0..1.
  // `occluded` is the older boolean form and maps onto the same axis, so a
  // caller that only knows "blocked / not blocked" still works.
  update(dt, {
    distance = Infinity, angleDeg = 180, holding = false,
    occluded = false, visibility = null,
  } = {}) {
    this.inRange = distance <= this.radius;
    this.onScreen = angleDeg <= this.angleDeg;
    this.holding = this.requireHold ? Boolean(holding) : true;

    const measured = visibility === null
      ? (occluded ? 0 : 1)
      : Math.min(1, Math.max(0, visibility));
    const ease = Math.min(1, this.visibilityEasePerSecond * dt);
    this.visibility += (measured - this.visibility) * ease;
    this.visibleScale = this.scaleForVisibility(this.visibility);
    this.visible = this.visibility > this.visibleHidden;

    if (this.captured) return this.getState();

    const filling = this.inRange && this.onScreen && this.holding;
    const step = filling
      ? this.fillPerSecond * dt * this.visibleScale
      : -this.decayPerSecond * dt;
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
      visible: this.visible,
      visibility: this.visibility,
      visibleScale: this.visibleScale,
      filling: this.inRange && this.onScreen && this.holding && !this.captured,
    };
  }

  // Short reason the player can act on, most blocking condition first.
  hint() {
    if (this.captured) return '검거 성공';
    if (!this.inRange) return '더 가까이';
    if (!this.onScreen) return '화면 중앙에 맞추세요';
    if (!this.holding) return 'SCAN 을 누르고 계세요';
    if (!this.visible) return '가려짐 — 매우 느림';
    // Still progressing, just slowly — say so rather than let it look stalled.
    if (this.visibleScale < 0.9) return '일부 가려짐 — 조금 느립니다';
    return '검거 중';
  }
}
