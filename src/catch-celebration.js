export const CATCH_CELEBRATION_DURATION_MS = 1000;
export const CATCH_CELEBRATION_TURNS = 2;

export class CatchCelebration {
  constructor({
    durationMs = CATCH_CELEBRATION_DURATION_MS,
    turns = CATCH_CELEBRATION_TURNS,
  } = {}) {
    this.durationMs = durationMs;
    this.turns = turns;
    this.reset();
  }

  start(time, initialRotationY = 0) {
    this.startedAt = time;
    this.initialRotationY = initialRotationY;
    this.active = true;
  }

  update(time) {
    if (!this.active) return null;
    const progress = Math.max(0, Math.min(1, (time - this.startedAt) / this.durationMs));
    const rotationY = this.initialRotationY + Math.PI * 2 * this.turns * progress;
    const completed = progress >= 1;
    if (completed) this.active = false;
    return { active: !completed, completed, progress, rotationY };
  }

  reset() {
    this.startedAt = 0;
    this.initialRotationY = 0;
    this.active = false;
  }
}