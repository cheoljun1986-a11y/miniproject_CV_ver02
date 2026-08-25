import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_MODES,
  depthUsageForMode,
  resolveAppMode,
  usesSpaceMapping,
} from '../src/app-mode.js';

test('default URL keeps GPU occlusion', () => {
  assert.equal(resolveAppMode(''), 'gpu-occlusion');
});

test('cloud URL selects point-cloud reconstruction', () => {
  assert.equal(resolveAppMode('?depth=cloud'), 'cloud');
});

test('CPU occlusion wins when both experimental parameters are present', () => {
  assert.equal(resolveAppMode('?depth=cloud&occlusion=cpu'), 'cpu-occlusion');
});

test('CPU modes request CPU-optimized WebXR depth', () => {
  assert.equal(depthUsageForMode('cloud'), 'cpu-optimized');
  assert.equal(depthUsageForMode('cpu-occlusion'), 'cpu-optimized');
  assert.equal(depthUsageForMode('gpu-occlusion'), 'gpu-optimized');
});

test('CPU occlusion and cloud diagnostics both accumulate a space map', () => {
  assert.equal(usesSpaceMapping(APP_MODES.CPU_OCCLUSION), true);
  assert.equal(usesSpaceMapping(APP_MODES.CLOUD), true);
  assert.equal(usesSpaceMapping(APP_MODES.GPU_OCCLUSION), false);
});
