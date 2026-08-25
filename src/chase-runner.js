// Drives Hachuping along the traversal grid while the player chases it.
//
// Movement is deliberately not free-form: the runner only ever advances along
// a path returned by findPath, one grid cell at a time, so it cannot cut
// through a wall or jump across the room. Height changes inside the path turn
// into a short arc, which is how it gets onto a table.
//
// Speed is tied to how close the player is. Far away it almost stops — without
// that it disappears across the room and the chase ends before it starts.
//
// Pure logic: positions in and out, no three.js.

import {
  chooseFleeTarget, findPath, pruneVisits, reachableFrom,
} from './chase-path.js';
import { nodeKey, MOVE } from './traversal-grid.js';

export const CHASE_SPEED_BANDS = Object.freeze([
  { withinM: 1.2, speed: 0.95 },
  { withinM: 2.0, speed: 0.85 },
  { withinM: 4.0, speed: 0.60 },
  { withinM: Infinity, speed: 0.25 },
]);

export function speedForDistance(distance, bands = CHASE_SPEED_BANDS) {
  for (const band of bands) {
    if (distance <= band.withinM) return band.speed;
  }
  return bands[bands.length - 1].speed;
}

export const CHASE_STATE = Object.freeze({
  IDLE: 'idle',
  WALK: 'walk',
  JUMP: 'jump',
  CAUGHT: 'caught',
});

export class ChaseRunner {
  constructor({
    grid,
    speedBands = CHASE_SPEED_BANDS,
    retargetMs = 3000,
    stuckMs = 4000,
    recentWindowMs = 15000,
    jumpSeconds = 0.5,
    jumpArcM = 0.22,
    hopHeightM = 0.05,
    hopHz = 2.4,
    random = Math.random,
  } = {}) {
    this.grid = grid;
    this.speedBands = speedBands;
    this.retargetMs = retargetMs;
    this.stuckMs = stuckMs;
    this.recentWindowMs = recentWindowMs;
    this.jumpSeconds = jumpSeconds;
    this.jumpArcM = jumpArcM;
    this.hopHeightM = hopHeightM;
    this.hopHz = hopHz;
    this.random = random;
    this.reset();
  }

  reset() {
    this.node = null;
    this.position = null;
    this.path = [];
    this.pathIndex = 0;
    this.target = null;
    this.state = CHASE_STATE.IDLE;
    this.heading = [0, 1];
    this.headingAngle = 0;
    this.recentVisits = new Map();
    this.lastRetargetAt = -Infinity;
    this.targetSetAt = -Infinity;
    this.jumpProgress = 0;
    this.jumpFrom = null;
    this.jumpTo = null;
    this.hopPhase = 0;
    this.frozen = false;
    this.replanFailures = 0;
    this.reachable = null;
  }

  getReachable() {
    return this.reachable;
  }

  // Drop onto the grid at (or near) a world point. Returns false when the map
  // has nowhere to stand yet.
  start(worldPosition, now = 0) {
    const node = this.grid.nodeAtWorld(worldPosition);
    if (!node) return false;
    this.reset();
    this.node = node;
    this.position = this.grid.worldOf(node);
    this.state = CHASE_STATE.WALK;
    this.lastRetargetAt = now;
    this.targetSetAt = now;
    this.markVisited(node, now);
    return true;
  }

  // Tracking loss should not be a free head start for Hachuping.
  setFrozen(frozen) {
    this.frozen = Boolean(frozen);
  }

  markVisited(node, now) {
    this.recentVisits.set(nodeKey(node.cx, node.cz, node.level), now);
  }

  isActive() {
    return this.state !== CHASE_STATE.IDLE && this.state !== CHASE_STATE.CAUGHT;
  }

  stop() {
    this.state = CHASE_STATE.CAUGHT;
  }

  // dt in seconds, now in ms.
  update(dt, { playerPosition = null, now = 0, speedMultiplier = 1 } = {}) {
    if (!this.isActive() || !this.position) return this.getState();
    if (this.frozen || dt <= 0) return this.getState();

    if (this.state === CHASE_STATE.JUMP) {
      this.advanceJump(dt, now);
      return this.getState();
    }

    const distance = playerPosition
      ? Math.hypot(
        this.position[0] - playerPosition[0],
        this.position[2] - playerPosition[2],
      )
      : Infinity;
    const speed = speedForDistance(distance, this.speedBands) * speedMultiplier;

    this.ensurePath(playerPosition, now);
    if (!this.path.length) return this.getState();

    let budget = speed * dt;
    let guard = 0;
    while (budget > 1e-6 && guard < 64) {
      guard += 1;
      const next = this.path[this.pathIndex];
      if (!next) {
        this.path = [];
        break;
      }
      const nextWorld = this.grid.worldOf(next);
      if (!nextWorld) {
        this.path = [];
        break;
      }

      if (next.move === MOVE.JUMP) {
        this.beginJump(nextWorld, next, now);
        return this.getState();
      }

      const dx = nextWorld[0] - this.position[0];
      const dz = nextWorld[2] - this.position[2];
      const step = Math.hypot(dx, dz);
      if (step <= budget || step < 1e-6) {
        this.position = nextWorld.slice();
        this.node = next;
        this.markVisited(next, now);
        this.pathIndex += 1;
        budget -= step;
        if (this.pathIndex >= this.path.length) {
          this.path = [];
          break;
        }
      } else {
        const ratio = budget / step;
        this.position = [
          this.position[0] + dx * ratio,
          this.position[1] + (nextWorld[1] - this.position[1]) * ratio,
          this.position[2] + dz * ratio,
        ];
        this.setHeading(dx, dz);
        budget = 0;
      }
    }

    this.hopPhase += dt * this.hopHz * Math.PI * 2 * (speed > 0.05 ? 1 : 0);
    pruneVisits(this.recentVisits, now, this.recentWindowMs);
    return this.getState();
  }

  setHeading(dx, dz) {
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    this.heading = [dx / length, dz / length];
    this.headingAngle = Math.atan2(dx, dz);
  }

  beginJump(toWorld, node, now) {
    this.jumpFrom = this.position.slice();
    this.jumpTo = toWorld.slice();
    this.jumpProgress = 0;
    this.state = CHASE_STATE.JUMP;
    this.pendingJumpNode = node;
    this.setHeading(toWorld[0] - this.position[0], toWorld[2] - this.position[2]);
    this.jumpStartedAt = now;
  }

  advanceJump(dt, now) {
    this.jumpProgress = Math.min(1, this.jumpProgress + dt / this.jumpSeconds);
    const t = this.jumpProgress;
    const arc = Math.sin(t * Math.PI) * this.jumpArcM;
    this.position = [
      this.jumpFrom[0] + (this.jumpTo[0] - this.jumpFrom[0]) * t,
      this.jumpFrom[1] + (this.jumpTo[1] - this.jumpFrom[1]) * t + arc,
      this.jumpFrom[2] + (this.jumpTo[2] - this.jumpFrom[2]) * t,
    ];
    if (t < 1) return;

    this.position = this.jumpTo.slice();
    this.node = this.pendingJumpNode;
    this.markVisited(this.node, now);
    this.pathIndex += 1;
    this.state = CHASE_STATE.WALK;
    if (this.pathIndex >= this.path.length) this.path = [];
  }

  // Pick a new destination when the current one is reached, has gone stale, or
  // could not be reached in time.
  ensurePath(playerPosition, now) {
    const needsTarget = !this.path.length
      || this.pathIndex >= this.path.length
      || now - this.targetSetAt > this.stuckMs
      || now - this.lastRetargetAt > this.retargetMs;
    if (!needsTarget) return;

    // Recomputed per retarget rather than per frame: the map grows while the
    // chase runs, so yesterday's flood would miss newly scanned ground.
    this.reachable = reachableFrom(this.grid, this.node);

    const target = chooseFleeTarget(this.grid, {
      from: this.node,
      playerPosition,
      recentVisits: this.recentVisits,
      now,
      recentWindowMs: this.recentWindowMs,
      heading: this.heading,
      random: this.random,
      reachable: this.reachable,
    });
    this.lastRetargetAt = now;
    if (!target) {
      this.replanFailures += 1;
      return;
    }

    const path = findPath(this.grid, this.node, target);
    if (!path || path.length < 2) {
      this.replanFailures += 1;
      return;
    }
    this.replanFailures = 0;
    this.target = target;
    this.targetSetAt = now;
    this.path = path.slice(1); // index 0 is where we already stand
    this.pathIndex = 0;
  }

  // Small vertical bob so a model with no skeleton still reads as moving.
  visualOffsetY() {
    if (this.state === CHASE_STATE.JUMP) return 0;
    return Math.abs(Math.sin(this.hopPhase)) * this.hopHeightM;
  }

  getState() {
    return {
      state: this.state,
      position: this.position ? this.position.slice() : null,
      visualY: this.position ? this.position[1] + this.visualOffsetY() : null,
      headingAngle: this.headingAngle,
      node: this.node,
      target: this.target,
      pathLength: this.path.length,
      pathIndex: this.pathIndex,
      replanFailures: this.replanFailures,
      frozen: this.frozen,
    };
  }

  // Remaining route in world space, for the operator view overlay.
  remainingPathWorld() {
    const out = [];
    if (this.position) out.push(this.position.slice());
    for (let i = this.pathIndex; i < this.path.length; i += 1) {
      const world = this.grid.worldOf(this.path[i]);
      if (world) out.push(world);
    }
    return out;
  }
}
