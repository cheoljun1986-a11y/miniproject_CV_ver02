import test from 'node:test';
import assert from 'node:assert/strict';

import { RpsRuntime } from '../src/rps-runtime.js';

function makeHarness({ manualMode = false } = {}) {
  const phases = [];
  const outcomes = [];
  const reveals = [];
  const errors = [];
  let manualMove = null;
  let captures = 0;
  let resets = 0;
  const ui = {
    setManualMode(value) { this.manual = value; },
    bindManualMoves(handler) { manualMove = handler; },
    setDuelVisible(value) { this.visible = value; },
    setCountdown(value) { this.countdown = value; },
    setHandStatus(value) { this.handStatus = value; },
    setDuelPhase(value) { this.duelPhase = value; },
    setHandPreview(value) { this.handPreview = value; },
    showMoves(value) { reveals.push(value); },
    showDuelError(value) { errors.push(value); },
  };
  const game = {
    setDuelPhase(phase) { phases.push(phase); },
    resolveDuel(outcome) { outcomes.push(outcome); return true; },
  };
  const recognizer = {
    async initialize() { this.status = { state: 'ready', detail: null }; return true; },
    recognize() { return 'paper'; },
    resetRound() { resets += 1; },
    getStatus() { return this.status ?? { state: 'ready', detail: null }; },
    getObservation() { return null; },
  };
  const inferenceCanvas = { name: 'inference-preview' };
  const cameraSource = {
    start() { return true; },
    capture() { captures += 1; return { frame: captures }; },
    reset() {},
    getCanvas() { return inferenceCanvas; },
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
    resetRendererState: () => { resets += 1; },
  });
  return {
    runtime, ui, phases, outcomes, reveals, errors,
    recognizer, cameraSource,
    submitManual: (move) => manualMove(move),
    getCaptures: () => captures,
    getResets: () => resets,
  };
}

test('duel result stays in the overlay without adding a move graphic to the field ninja', () => {
  const h = makeHarness({ manualMode: true });
  h.runtime.startDuel(0);
  h.runtime.update(10, {}, {});
  h.submitManual('paper');
  assert.deepEqual(h.reveals, [{
    playerMove: 'paper',
    ninjaMove: 'rock',
    result: 'win',
  }]);
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

test('session startup begins model loading without blocking AR camera startup', () => {
  const h = makeHarness();
  let finishLoading;
  h.recognizer.status = { state: 'idle', detail: null };
  h.recognizer.initialize = () => new Promise((resolve) => {
    finishLoading = resolve;
  });

  assert.equal(h.runtime.startSession({}, {}), true);
  assert.equal(h.ui.handPreview.name, 'inference-preview');
  assert.match(h.ui.handStatus, /모델.*준비/);
  finishLoading(true);
});

test('reading phase shows the current gesture candidate and agreement progress', () => {
  const h = makeHarness();
  h.recognizer.recognize = () => null;
  h.recognizer.getObservation = () => ({
    detected: true,
    move: 'rock',
    confidence: 0.81,
    matches: 2,
    requiredMatches: 3,
  });
  h.runtime.startSession({}, {});
  h.runtime.startDuel(0);
  h.runtime.update(10, {}, {});

  assert.match(h.ui.handStatus, /바위/);
  assert.match(h.ui.handStatus, /2\/3/);
  assert.match(h.ui.handStatus, /81%/);
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

test('session reset clears the active duel overlay', () => {
  const h = makeHarness({ manualMode: true });
  h.runtime.startDuel(0);
  h.runtime.update(10, {}, {});
  h.submitManual('rock');
  h.runtime.resetSession();
  assert.equal(h.ui.visible, false);
});
