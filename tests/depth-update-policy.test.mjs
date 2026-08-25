import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDepthStale,
  isDepthUpdateDue,
  shouldUpdatePointGeometry,
} from '../src/depth-update-policy.js';

test('lets occlusion and mapping keep independent update intervals', () => {
  assert.equal(isDepthUpdateDue(0, 65, 66), false);
  assert.equal(isDepthUpdateDue(0, 66, 66), true);
  assert.equal(isDepthUpdateDue(0, 199, 200), false);
  assert.equal(isDepthUpdateDue(0, 200, 200), true);
  assert.equal(isDepthUpdateDue(-Infinity, 0, 200), true);
});

test('marks an occlusion mesh stale only after the configured age', () => {
  assert.equal(isDepthStale(100, 350, 250), false);
  assert.equal(isDepthStale(100, 351, 250), true);
  assert.equal(isDepthStale(-Infinity, 0, 250), true);
});

test('updates raw point geometry only when point rendering is enabled', () => {
  assert.equal(shouldUpdatePointGeometry(false), false);
  assert.equal(shouldUpdatePointGeometry(true), true);
});
