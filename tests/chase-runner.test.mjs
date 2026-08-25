import test from 'node:test';
import assert from 'node:assert/strict';

import { TraversalGrid, MOVE } from '../src/traversal-grid.js';
import { findPath } from '../src/chase-path.js';
import { ChaseRunner, speedForDistance, CHASE_STATE } from '../src/chase-runner.js';
import { CaptureGauge, angleToTargetDeg } from '../src/capture-gauge.js';

function room(grid, width = 6, depth = 6, step = 0.1) {
  for (let x = 0; x <= width; x += step) {
    for (let z = 0; z <= depth; z += step) grid.observe([x, 0.02, z]);
  }
}

function run(runner, seconds, options, dt = 1 / 60) {
  let now = options.now ?? 0;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    now += dt * 1000;
    runner.update(dt, { ...options, now });
  }
  return now;
}

// ── speed ────────────────────────────────────────────────────
test('it nearly stops when the player is far away', () => {
  assert.equal(speedForDistance(10), 0.12);
});

test('it runs fastest when the player is on top of it', () => {
  assert.equal(speedForDistance(0.8), 0.50);
});

// It has to be catchable by someone walking while staring at a phone, which is
// a good deal slower than an unencumbered walk.
test('its top speed stays well under a walking player', () => {
  assert.ok(speedForDistance(0) < 0.6);
});

// ── movement ─────────────────────────────────────────────────
test('start fails when nothing has been mapped', () => {
  const runner = new ChaseRunner({ grid: new TraversalGrid() });
  assert.equal(runner.start([0, 0, 0]), false);
});

test('it actually moves once the chase begins', () => {
  const grid = new TraversalGrid();
  room(grid);
  const runner = new ChaseRunner({ grid, random: () => 0.5 });
  assert.equal(runner.start([3, 0, 3], 0), true);
  const from = runner.position.slice();
  run(runner, 3, { playerPosition: [3.4, 1.5, 3.4] });
  const moved = Math.hypot(runner.position[0] - from[0], runner.position[2] - from[2]);
  assert.ok(moved > 0.3, `expected movement, got ${moved.toFixed(3)}m`);
});

test('it never leaves the mapped floor', () => {
  const grid = new TraversalGrid();
  room(grid, 4, 4);
  const runner = new ChaseRunner({ grid, random: () => 0.5 });
  runner.start([2, 0, 2], 0);
  let now = 0;
  for (let i = 0; i < 3600; i += 1) {
    now += 1000 / 60;
    runner.update(1 / 60, { playerPosition: [2, 1.5, 2], now });
    const [x, , z] = runner.position;
    assert.ok(x >= -0.3 && x <= 4.3 && z >= -0.3 && z <= 4.3,
      `left the room at ${x.toFixed(2)}, ${z.toFixed(2)}`);
  }
});

test('a frozen runner holds still', () => {
  const grid = new TraversalGrid();
  room(grid);
  const runner = new ChaseRunner({ grid, random: () => 0.5 });
  runner.start([3, 0, 3], 0);
  runner.setFrozen(true);
  const before = runner.position.slice();
  run(runner, 2, { playerPosition: [3.5, 1.5, 3.5] });
  assert.deepEqual(runner.position, before);
});

test('it does not sit in one corner — it covers ground', () => {
  const grid = new TraversalGrid();
  room(grid, 6, 6);
  const runner = new ChaseRunner({ grid, random: () => 0.5 });
  runner.start([3, 0, 3], 0);

  const seen = new Set();
  let now = 0;
  for (let i = 0; i < 60 * 40; i += 1) {
    now += 1000 / 60;
    runner.update(1 / 60, { playerPosition: [0.3, 1.5, 0.3], now });
    seen.add(`${runner.grid.cellX(runner.position[0])},${runner.grid.cellZ(runner.position[2])}`);
  }
  // Ground covered scales with speed, and the speeds were halved after the
  // first on-device test. Sitting in one corner would show up as a handful of
  // cells, so the threshold is still far above the failure it guards against.
  assert.ok(seen.size > 15, `only visited ${seen.size} cells in 40s`);
});

// Floor on the left, a 40cm ledge on the right. The only way across is up.
function floorAndLedge() {
  const grid = new TraversalGrid();
  for (let x = 0; x <= 1.3; x += 0.1) {
    for (let z = 0; z <= 1.3; z += 0.1) grid.observe([x, 0.02, z]);
  }
  for (let x = 1.5; x <= 3.5; x += 0.1) {
    for (let z = 0; z <= 1.3; z += 0.1) grid.observe([x, 0.42, z]);
  }
  return grid;
}

test('a low platform is a jump edge, not a walk', () => {
  const grid = floorAndLedge();
  const edge = { cx: grid.cellX(1.25), cz: grid.cellZ(0.6), level: 0 };
  const up = grid.neighbors(edge).find((n) => n.cx === grid.cellX(1.5));
  assert.ok(up, 'the ledge should be an edge at all');
  assert.equal(up.move, MOVE.JUMP);
});

test('a route onto the ledge contains the jump', () => {
  const grid = floorAndLedge();
  const start = grid.nodeAtWorld([0.3, 0.1, 0.6]);
  const goal = grid.nodeAtWorld([3.3, 0.5, 0.6]);
  const path = findPath(grid, start, goal);
  assert.ok(path, 'the ledge should be reachable');
  assert.ok(path.some((n) => n.move === MOVE.JUMP), 'route avoided jumping entirely');
});

test('it actually performs the jump when that is the only way on', () => {
  const grid = floorAndLedge();
  const runner = new ChaseRunner({ grid, random: () => 0.5 });
  runner.start([0.3, 0, 0.6], 0);
  let sawJump = false;
  let now = 0;
  for (let i = 0; i < 60 * 60; i += 1) {
    now += 1000 / 60;
    runner.update(1 / 60, { playerPosition: [0.2, 1.5, 0.6], now });
    if (runner.state === CHASE_STATE.JUMP) sawJump = true;
  }
  assert.ok(sawJump, 'never jumped onto the ledge in 60s');
});

// ── capture ──────────────────────────────────────────────────
test('the gauge only fills when all three conditions hold', () => {
  const gauge = new CaptureGauge({ requireHold: true });
  gauge.update(1, { distance: 0.8, angleDeg: 5, holding: false });
  assert.equal(gauge.value, 0);
  gauge.update(1, { distance: 3.0, angleDeg: 5, holding: true });
  assert.equal(gauge.value, 0);
  gauge.update(1, { distance: 0.8, angleDeg: 60, holding: true });
  assert.equal(gauge.value, 0);
  gauge.update(1, { distance: 0.8, angleDeg: 5, holding: true });
  assert.ok(gauge.value > 0);
});

// The shipped rule is range plus aim only: holding a button turned into an
// Android long press, which raises the text-selection toolbar over the game.
test('by default no button hold is needed', () => {
  const gauge = new CaptureGauge();
  gauge.update(1, { distance: 0.8, angleDeg: 5 });
  assert.ok(gauge.value > 0);
  assert.equal(gauge.hint(), '검거 중');
});

test('five good seconds capture', () => {
  const gauge = new CaptureGauge();
  for (let i = 0; i < 50; i += 1) {
    gauge.update(0.1, { distance: 0.8, angleDeg: 5, holding: true });
  }
  assert.equal(gauge.captured, true);
});

test('a brief slip decays the gauge instead of resetting it', () => {
  const gauge = new CaptureGauge();
  for (let i = 0; i < 20; i += 1) gauge.update(0.1, { distance: 0.8, angleDeg: 5, holding: true });
  const before = gauge.value;
  gauge.update(0.2, { distance: 4, angleDeg: 5, holding: true });
  assert.ok(gauge.value > 0, 'gauge should not reset');
  assert.ok(gauge.value < before, 'gauge should decay');
});

test('hachuping slows as the lock builds', () => {
  const gauge = new CaptureGauge();
  assert.equal(gauge.speedMultiplier(), 1);
  gauge.value = 0.5;
  assert.ok(gauge.speedMultiplier() < 1);
  gauge.value = 0.8;
  assert.ok(gauge.speedMultiplier() < 0.5);
});

test('the hint names the condition that is blocking', () => {
  const gauge = new CaptureGauge({ requireHold: true });
  gauge.update(0.1, { distance: 5, angleDeg: 5, holding: true });
  assert.equal(gauge.hint(), '더 가까이');
  gauge.update(0.1, { distance: 0.8, angleDeg: 90, holding: true });
  assert.equal(gauge.hint(), '화면 중앙에 맞추세요');
  gauge.update(0.1, { distance: 0.8, angleDeg: 5, holding: false });
  assert.equal(gauge.hint(), 'SCAN 을 누르고 계세요');
});

test('angle to target is zero straight ahead and 180 behind', () => {
  const forward = [0, 0, -1];
  assert.ok(angleToTargetDeg(forward, [0, 0, 0], [0, 0, -2]) < 1e-6);
  assert.ok(Math.abs(angleToTargetDeg(forward, [0, 0, 0], [0, 0, 2]) - 180) < 1e-6);
});

// ── screen direction ─────────────────────────────────────────
test('view-space direction is straight ahead for an unrotated viewer', async () => {
  const { directionInViewSpace } = await import('../src/capture-gauge.js');
  const dir = directionInViewSpace([0, 0, 0, 1], [0, 0, 0], [0, 0, -2]);
  assert.ok(Math.abs(dir[0]) < 1e-9);
  assert.ok(Math.abs(dir[1]) < 1e-9);
  assert.ok(dir[2] < 0, 'forward is -Z');
});

test('turning the viewer 90 degrees moves the target to the side', async () => {
  const { directionInViewSpace } = await import('../src/capture-gauge.js');
  // Yaw +90 degrees about Y.
  const s = Math.sin(Math.PI / 4);
  const c = Math.cos(Math.PI / 4);
  const dir = directionInViewSpace([0, s, 0, c], [0, 0, 0], [0, 0, -2]);
  assert.ok(Math.abs(dir[2]) < 1e-6, 'no longer straight ahead');
  assert.ok(Math.abs(dir[0]) > 1.9, 'now off to the side');
});

test('the arrow points up when the target is above centre', async () => {
  const { screenAngleFromViewDirection } = await import('../src/capture-gauge.js');
  assert.equal(screenAngleFromViewDirection([0, 1]), 0);
  assert.ok(Math.abs(screenAngleFromViewDirection([1, 0]) - Math.PI / 2) < 1e-9);
});
