import test from 'node:test';
import assert from 'node:assert/strict';

import { PlayerTrail } from '../src/player-trail.js';

test('records the first point and then only steps beyond minStep', () => {
  const trail = new PlayerTrail({ minStep: 0.1, maxPoints: 10 });
  assert.equal(trail.record([0, 0, 0]), true);
  assert.equal(trail.record([0.05, 0, 0]), false); // below minStep
  assert.equal(trail.record([0.2, 0, 0]), true);
  assert.deepEqual(trail.getPoints(), [[0, 0, 0], [0.2, 0, 0]]);
});

test('caps length by dropping the oldest point', () => {
  const trail = new PlayerTrail({ minStep: 0.1, maxPoints: 2 });
  trail.record([0, 0, 0]);
  trail.record([1, 0, 0]);
  trail.record([2, 0, 0]);
  assert.deepEqual(trail.getPoints(), [[1, 0, 0], [2, 0, 0]]);
});

test('reset empties the trail', () => {
  const trail = new PlayerTrail({});
  trail.record([0, 0, 0]);
  trail.reset();
  assert.deepEqual(trail.getPoints(), []);
});
