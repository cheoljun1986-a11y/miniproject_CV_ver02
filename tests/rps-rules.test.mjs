import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOVES,
  chooseMove,
  evaluateRound,
  mapGestureLabel,
} from '../src/rps-rules.js';

test('maps MediaPipe hand categories to rock paper scissors', () => {
  assert.equal(mapGestureLabel('Closed_Fist'), 'rock');
  assert.equal(mapGestureLabel('Open_Palm'), 'paper');
  assert.equal(mapGestureLabel('Victory'), 'scissors');
  assert.equal(mapGestureLabel('None'), null);
  assert.equal(mapGestureLabel('Thumb_Up'), null);
});

test('chooses one of three moves at stable random boundaries', () => {
  assert.deepEqual(MOVES, ['rock', 'paper', 'scissors']);
  assert.equal(chooseMove(() => 0), 'rock');
  assert.equal(chooseMove(() => 0.3334), 'paper');
  assert.equal(chooseMove(() => 0.999999), 'scissors');
  assert.equal(chooseMove(() => 1), 'scissors');
});

test('evaluates every rock paper scissors outcome', () => {
  const cases = [
    ['rock', 'rock', 'draw'],
    ['rock', 'scissors', 'win'],
    ['rock', 'paper', 'lose'],
    ['paper', 'paper', 'draw'],
    ['paper', 'rock', 'win'],
    ['paper', 'scissors', 'lose'],
    ['scissors', 'scissors', 'draw'],
    ['scissors', 'paper', 'win'],
    ['scissors', 'rock', 'lose'],
  ];
  for (const [player, ninja, expected] of cases) {
    assert.equal(evaluateRound(player, ninja), expected);
  }
});

test('rejects invalid round moves instead of silently treating them as a draw', () => {
  assert.throws(() => evaluateRound('lizard', 'rock'), TypeError);
  assert.throws(() => evaluateRound('rock', null), TypeError);
});
