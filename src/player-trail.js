// Distance-gated, fixed-capacity buffer of viewer positions for the operator
// view's path line. Framework-free and unit-tested.
export class PlayerTrail {
  constructor({ minStep = 0.15, maxPoints = 300 } = {}) {
    this.minStep = minStep;
    this.maxPoints = maxPoints;
    this.points = [];
  }

  record([x, y, z]) {
    const last = this.points[this.points.length - 1];
    if (last) {
      const step = Math.hypot(x - last[0], y - last[1], z - last[2]);
      if (step <= this.minStep) return false;
    }
    this.points.push([x, y, z]);
    if (this.points.length > this.maxPoints) this.points.shift();
    return true;
  }

  getPoints() {
    return this.points.map((point) => [...point]);
  }

  getCount() {
    return this.points.length;
  }

  reset() {
    this.points = [];
  }
}
