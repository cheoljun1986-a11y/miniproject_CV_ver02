import test from 'node:test';
import assert from 'node:assert/strict';

import { GestureConsensus } from '../src/gesture-consensus.js';
import {
  HAND_MIN_CONFIDENCE,
  HAND_REQUIRED_MATCHES,
  HAND_SAMPLE_MAX_AGE_MS,
  HAND_SAMPLE_WINDOW,
} from '../src/config.js';

function makeConsensus(overrides = {}) {
  return new GestureConsensus({
    minConfidence: 0.7,
    requiredMatches: 3,
    windowSize: 5,
    maxAgeMs: 500,
    ...overrides,
  });
}

test('emits a move only after enough confident matching samples', () => {
  const consensus = makeConsensus();
  assert.equal(consensus.add({ move: 'rock', confidence: 0.9, time: 0 }), null);
  assert.equal(consensus.add({ move: 'rock', confidence: 0.8, time: 100 }), null);
  assert.equal(consensus.add({ move: 'rock', confidence: 0.85, time: 200 }), 'rock');
});

test('reports stable-sample progress before a move is confirmed', () => {
  const consensus = makeConsensus();
  consensus.add({ move: 'rock', confidence: 0.82, time: 0 });
  consensus.add({ move: 'rock', confidence: 0.78, time: 100 });

  assert.equal(typeof consensus.getProgress, 'function');
  assert.deepEqual(consensus.getProgress(), {
    move: 'rock',
    matches: 2,
    requiredMatches: 3,
  });
});

test('rejects low confidence unsupported and mixed samples', () => {
  const consensus = makeConsensus();
  assert.equal(consensus.add({ move: 'rock', confidence: 0.69, time: 0 }), null);
  assert.equal(consensus.add({ move: 'lizard', confidence: 0.99, time: 10 }), null);
  assert.equal(consensus.add({ move: 'rock', confidence: 0.9, time: 20 }), null);
  assert.equal(consensus.add({ move: 'paper', confidence: 0.9, time: 30 }), null);
  assert.equal(consensus.add({ move: 'rock', confidence: 0.9, time: 40 }), null);
  assert.equal(consensus.add({ move: 'paper', confidence: 0.9, time: 50 }), null);
});

test('expires stale samples before counting agreement', () => {
  const consensus = makeConsensus();
  consensus.add({ move: 'scissors', confidence: 0.9, time: 0 });
  consensus.add({ move: 'scissors', confidence: 0.9, time: 100 });
  assert.equal(consensus.add({ move: 'scissors', confidence: 0.9, time: 700 }), null);
});

test('emits once per round and reset starts a fresh round', () => {
  const consensus = makeConsensus({ requiredMatches: 2 });
  consensus.add({ move: 'paper', confidence: 0.9, time: 0 });
  assert.equal(consensus.add({ move: 'paper', confidence: 0.9, time: 10 }), 'paper');
  assert.equal(consensus.add({ move: 'paper', confidence: 0.99, time: 20 }), null);
  consensus.reset();
  assert.equal(consensus.add({ move: 'paper', confidence: 0.9, time: 30 }), null);
  assert.equal(consensus.add({ move: 'paper', confidence: 0.9, time: 40 }), 'paper');
});

test('bounds the active sample window', () => {
  const consensus = makeConsensus({ requiredMatches: 3, windowSize: 3 });
  consensus.add({ move: 'rock', confidence: 0.9, time: 0 });
  consensus.add({ move: 'rock', confidence: 0.9, time: 10 });
  consensus.add({ move: 'paper', confidence: 0.9, time: 20 });
  consensus.add({ move: 'paper', confidence: 0.9, time: 30 });
  assert.equal(consensus.add({ move: 'paper', confidence: 0.9, time: 40 }), 'paper');
});

test('app settings accept three consistent moderate-confidence frames', () => {
  const consensus = new GestureConsensus({
    minConfidence: HAND_MIN_CONFIDENCE,
    requiredMatches: HAND_REQUIRED_MATCHES,
    windowSize: HAND_SAMPLE_WINDOW,
    maxAgeMs: HAND_SAMPLE_MAX_AGE_MS,
  });
  assert.equal(consensus.add({ move: 'paper', confidence: 0.6, time: 0 }), null);
  assert.equal(consensus.add({ move: 'paper', confidence: 0.6, time: 100 }), null);
  assert.equal(consensus.add({ move: 'paper', confidence: 0.6, time: 200 }), 'paper');
});
