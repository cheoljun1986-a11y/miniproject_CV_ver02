import test from 'node:test';
import assert from 'node:assert/strict';

import { GestureConsensus } from '../src/gesture-consensus.js';
import { HandGestureRecognizer } from '../src/hand-gesture-recognizer.js';

function makeConsensus(requiredMatches = 2) {
  return new GestureConsensus({
    minConfidence: 0.7,
    requiredMatches,
    windowSize: 4,
    maxAgeMs: 500,
  });
}

function result(label, score) {
  return {
    gestures: [[{
      categoryName: label,
      score,
      index: -1,
      displayName: '',
    }]],
    handedness: [[{
      categoryName: 'Right',
      score: 0.99,
      index: 0,
      displayName: 'Right',
    }]],
    landmarks: [[]],
    worldLandmarks: [[]],
  };
}

test('initializes and emits only a stable mapped hand move', async () => {
  const calls = [];
  const recognizer = new HandGestureRecognizer({
    consensus: makeConsensus(),
    createRecognizer: async () => ({
      recognizeForVideo(image, time) {
        calls.push({ image, time });
        return result('Closed_Fist', 0.91);
      },
      close() {},
    }),
  });

  assert.equal(recognizer.getStatus().state, 'idle');
  assert.equal(await recognizer.initialize(), true);
  assert.equal(recognizer.getStatus().state, 'ready');
  assert.equal(recognizer.recognize({ frame: 1 }, 10), null);
  assert.equal(recognizer.recognize({ frame: 2 }, 20), 'rock');
  assert.deepEqual(calls, [
    { image: { frame: 1 }, time: 10 },
    { image: { frame: 2 }, time: 20 },
  ]);
});

test('ignores absent unsupported and low confidence gestures', async () => {
  const outputs = [
    { gestures: [], handedness: [], landmarks: [], worldLandmarks: [] },
    result('Thumb_Up', 0.99),
    result('Victory', 0.69),
  ];
  const recognizer = new HandGestureRecognizer({
    consensus: makeConsensus(1),
    createRecognizer: async () => ({
      recognizeForVideo: () => outputs.shift(),
      close() {},
    }),
  });
  await recognizer.initialize();

  assert.equal(recognizer.recognize({}, 0), null);
  assert.equal(recognizer.recognize({}, 10), null);
  assert.equal(recognizer.recognize({}, 20), null);
  assert.equal(recognizer.getStatus().state, 'ready');
});

test('resetRound discards agreement from the previous throw', async () => {
  const recognizer = new HandGestureRecognizer({
    consensus: makeConsensus(),
    createRecognizer: async () => ({
      recognizeForVideo: () => result('Open_Palm', 0.9),
      close() {},
    }),
  });
  await recognizer.initialize();
  assert.equal(recognizer.recognize({}, 0), null);
  recognizer.resetRound();
  assert.equal(recognizer.recognize({}, 10), null);
  assert.equal(recognizer.recognize({}, 20), 'paper');
});

test('contains initialization and inference failures as status', async () => {
  const initFailure = new HandGestureRecognizer({
    consensus: makeConsensus(),
    createRecognizer: async () => { throw new Error('model missing'); },
  });
  assert.equal(await initFailure.initialize(), false);
  assert.deepEqual(initFailure.getStatus(), {
    state: 'error',
    detail: 'model missing',
  });

  const inferenceFailure = new HandGestureRecognizer({
    consensus: makeConsensus(),
    createRecognizer: async () => ({
      recognizeForVideo: () => { throw new Error('inference failed'); },
      close() {},
    }),
  });
  await inferenceFailure.initialize();
  assert.equal(inferenceFailure.recognize({}, 0), null);
  assert.deepEqual(inferenceFailure.getStatus(), {
    state: 'error',
    detail: 'inference failed',
  });
});

test('close releases MediaPipe and resets state', async () => {
  let closed = false;
  const recognizer = new HandGestureRecognizer({
    consensus: makeConsensus(),
    createRecognizer: async () => ({
      recognizeForVideo: () => result('Victory', 0.9),
      close() { closed = true; },
    }),
  });
  await recognizer.initialize();
  recognizer.close();
  assert.equal(closed, true);
  assert.deepEqual(recognizer.getStatus(), { state: 'idle', detail: null });
});
