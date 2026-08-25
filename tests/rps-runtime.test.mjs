import test from 'node:test';
import assert from 'node:assert/strict';

import { RpsRuntime } from '../src/rps-runtime.js';

function makeHarness({ manualMode = false } = {}) {
  const phases = [];
  const outcomes = [];
  const reveals = [];
  const errors = [];
  const target = { name: 'ninja' };
  let manualMove = null;
  let captures = 0;
  let resets = 0;
  const ui = {
    setManualMode(value) { this.manual = value; },
    bindManualMoves(handler) { manualMove = handler; },
    setDuelVisible(value) { this.visible = value; },
    setCountdown(value) { this.countdown = value; },
    setHandStatus(value) { this.handStatus = value; },
    showMoves(value) { reveals.push(value); },
    showDuelError(value) { errors.push(value); },
  };
  const game = {
    setDuelPhase(phase) { phases.push(phase); },
    resolveDuel(outcome) { outcomes.push(outcome); return true; },
    getTargetObject: () => target,
  };
  const recognizer = {
    async initialize() { this.status = { state: 'ready', detail: null }; return true; },
    recognize() { return 'paper'; },
    resetRound() { resets += 1; },
    getStatus() { return this.status ?? { state: 'ready', detail: null }; },
  };
  const cameraSource = {
    start() { return true; },
    capture() { captures += 1; return { frame: captures }; },
    reset() {},
    getStatus() { return { state: 'ready', detail: null }; },
  };
  const runtime = new RpsRuntime({
    ui,
    game,
    recognizer,
    cameraSource,
    manualMode,
    random: () => 0,
    countdownMs: 10,
    readTimeoutMs: 100,
    resultMs: 10,
    showNinjaMove: (root, move) => { root.move = move; },
    clearNinjaMove: (root) => { delete root.move; },
    resetRendererState: () => { resets += 1; },
  });
  return {
    runtime, ui, phases, outcomes, reveals, errors, target,
    recognizer, cameraSource,
    submitManual: (move) => manualMove(move),
    getCaptures: () => captures,
    getResets: () => resets,
  };
}

test('manual diagnostic input uses the same duel result path without camera capture', () => {
  const h = makeHarness({ manualMode: true });
  h.runtime.startDuel(0);
  h.runtime.update(10, {}, {});
  h.submitManual('paper');
  assert.deepEqual(h.reveals, [{
    playerMove: 'paper',
    ninjaMove: 'rock',
    result: 'win',
  }]);
  assert.equal(h.target.move, 'rock');
  h.runtime.update(20, {}, {});
  assert.deepEqual(h.outcomes, ['win']);
  assert.equal(h.getCaptures(), 0);
});

test('camera mode copies and recognizes only during the reading phase', () => {
  const h = makeHarness();
  h.runtime.startSession({}, {});
  h.runtime.startDuel(0);
  h.runtime.update(9, {}, {});
  assert.equal(h.getCaptures(), 0);
  h.runtime.update(10, {}, {});
  assert.equal(h.getCaptures(), 1);
  assert.deepEqual(h.reveals[0], {
    playerMove: 'paper',
    ninjaMove: 'rock',
    result: 'win',
  });
  assert.ok(h.getResets() > 0);
});

test('camera capability failure is visible and never enables manual fallback', () => {
  const h = makeHarness();
  h.cameraSource.start = () => false;
  h.cameraSource.getStatus = () => ({
    state: 'unavailable',
    detail: 'camera-access missing',
  });
  assert.equal(h.runtime.startSession({}, {}), false);
  assert.equal(h.ui.manual, false);
  assert.match(h.errors.at(-1), /camera-access/);
});

test('session reset clears active duel graphics and overlay', () => {
  const h = makeHarness({ manualMode: true });
  h.runtime.startDuel(0);
  h.runtime.update(10, {}, {});
  h.submitManual('rock');
  assert.equal(h.target.move, 'rock');
  h.runtime.resetSession();
  assert.equal(h.target.move, undefined);
  assert.equal(h.ui.visible, false);
});
