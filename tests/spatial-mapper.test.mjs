import test from 'node:test';
import assert from 'node:assert/strict';

import { SpatialMapper } from '../src/spatial-mapper.js';

test('surface sampling keeps the existing minimum spacing rule', () => {
  const mapper = new SpatialMapper({ minCandidateSpacing: 0.22 });

  assert.equal(mapper.recordSurface({ position: [0, 0, 0], matrix: [1], upY: 1 }), true);
  assert.equal(mapper.recordSurface({ position: [0.1, 0, 0], matrix: [2], upY: 1 }), false);
  assert.equal(mapper.recordSurface({ position: [0.22, 0, 0], matrix: [3], upY: 1 }), true);
  assert.equal(mapper.getPool().length, 2);
});

test('surface pool prefers horizontal candidates after five samples', () => {
  const mapper = new SpatialMapper({ minCandidateSpacing: 0 });

  for (let index = 0; index < 5; index += 1) {
    mapper.recordSurface({ position: [index, 0, 0], matrix: [index], upY: 0.8 });
  }
  mapper.recordSurface({ position: [6, 0, 0], matrix: [6], upY: 0.2 });

  assert.equal(mapper.getPool().length, 5);
});

test('viewer movement ignores tracking jumps but preserves maximum displacement', () => {
  const mapper = new SpatialMapper({ maxTrackingStep: 0.35 });

  mapper.recordViewer([0, 0, 0]);
  mapper.recordViewer([0.3, 0, 0]);
  mapper.recordViewer([1, 0, 0]);

  const metrics = mapper.getMetrics();
  assert.equal(metrics.pathDistance, 0.3);
  assert.equal(metrics.maxDisplacement, 1);
});

test('checkpoint error reports position and quaternion angle differences', () => {
  const mapper = new SpatialMapper();
  mapper.saveCheckpoint([0, 0, 0], [0, 0, 0, 1]);

  const result = mapper.checkReturnError(
    [0.3, 0.4, 0],
    [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  );

  assert.equal(result.posErr, 0.5);
  assert.ok(Math.abs(result.angleErr - 90) < 1e-9);
});
