import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATCH_CELEBRATION_DURATION_MS,
  CATCH_CELEBRATION_TURNS,
  CatchCelebration,
} from '../src/catch-celebration.js';

test('catch celebration turns the character twice in exactly one second', () => {
  const celebration = new CatchCelebration();
  celebration.start(1000, 0.25);

  assert.deepEqual(celebration.update(1000), {
    active: true,
    completed: false,
    progress: 0,
    rotationY: 0.25,
  });

  const halfway = celebration.update(1500);
  assert.equal(halfway.active, true);
  assert.equal(halfway.completed, false);
  assert.equal(halfway.progress, 0.5);
  assert.ok(Math.abs(halfway.rotationY - (0.25 + Math.PI * 2)) < 1e-9);

  const finished = celebration.update(2000);
  assert.equal(finished.active, false);
  assert.equal(finished.completed, true);
  assert.equal(finished.progress, 1);
  assert.ok(Math.abs(
    finished.rotationY - (0.25 + Math.PI * 2 * CATCH_CELEBRATION_TURNS),
  ) < 1e-9);
  assert.equal(CATCH_CELEBRATION_DURATION_MS, 1000);
  assert.equal(CATCH_CELEBRATION_TURNS, 2);
});

test('an idle celebration leaves the caller with no animation frame', () => {
  const celebration = new CatchCelebration();
  assert.equal(celebration.update(1000), null);
});