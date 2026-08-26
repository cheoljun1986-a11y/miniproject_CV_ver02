import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VOXEL_DEBUG_PARAMS,
  VOXEL_DEBUG_CONTROLS,
  applyParam,
  clampParam,
  normalizeParams,
} from '../src/voxel-debug-params.js';

test('values clamp to the control range and snap to the step', () => {
  assert.equal(clampParam('nearM', -5), 0.10);
  assert.equal(clampParam('nearM', 99), 2.00);
  assert.equal(clampParam('minObservations', 2.4), 2);
  assert.equal(clampParam('minObservations', 9), 4);
  assert.ok(Math.abs(clampParam('gradientMaxJumpM', 0.123) - 0.12) < 1e-9);
});

test('an unknown id leaves the params untouched', () => {
  const result = applyParam(DEFAULT_VOXEL_DEBUG_PARAMS, 'nope', 1);
  assert.equal(result.changed, false);
  assert.equal(result.needsRebuild, false);
  assert.deepEqual(result.params, DEFAULT_VOXEL_DEBUG_PARAMS);
});

// The load-bearing distinction: minObservations is a render-time filter over
// getCells(), so dragging it must never trigger a rebuild.
test('only the ingest-shaping params require a rebuild', () => {
  assert.equal(applyParam(DEFAULT_VOXEL_DEBUG_PARAMS, 'minObservations', 3).needsRebuild, false);
  assert.equal(applyParam(DEFAULT_VOXEL_DEBUG_PARAMS, 'voxelSize', 0.03).needsRebuild, true);
  assert.equal(applyParam(DEFAULT_VOXEL_DEBUG_PARAMS, 'nearM', 0.5).needsRebuild, true);
  assert.equal(applyParam(DEFAULT_VOXEL_DEBUG_PARAMS, 'farM', 6).needsRebuild, true);
  assert.equal(
    applyParam(DEFAULT_VOXEL_DEBUG_PARAMS, 'gradientMaxJumpM', 0.2).needsRebuild,
    true,
  );
});

test('setting the same value twice reports no change', () => {
  const first = applyParam(DEFAULT_VOXEL_DEBUG_PARAMS, 'minObservations', 3);
  assert.equal(first.changed, true);
  assert.equal(applyParam(first.params, 'minObservations', 3).changed, false);
});

// A near > far state empties the map silently and looks like a depth failure.
test('normalizeParams keeps the near clip below the far clip', () => {
  const crossed = normalizeParams({ ...DEFAULT_VOXEL_DEBUG_PARAMS, nearM: 6, farM: 5 });
  assert.ok(crossed.nearM < crossed.farM);

  const viaApply = applyParam(DEFAULT_VOXEL_DEBUG_PARAMS, 'nearM', 2.0);
  assert.ok(viaApply.params.nearM < viaApply.params.farM);
});

test('the schema and the defaults agree', () => {
  assert.equal(VOXEL_DEBUG_CONTROLS.length, Object.keys(DEFAULT_VOXEL_DEBUG_PARAMS).length);
  for (const control of VOXEL_DEBUG_CONTROLS) {
    assert.equal(DEFAULT_VOXEL_DEBUG_PARAMS[control.id], control.value);
    assert.ok(control.min <= control.value && control.value <= control.max);
    assert.equal(typeof control.label, 'string');
  }
});
