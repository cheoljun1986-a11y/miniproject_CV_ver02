import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMetrics } from '../src/ui.js';

test('formatMetrics preserves the existing HUD measurements', () => {
  const output = formatMetrics({
    viewerPosition: [1.234, 2.345, -3.456],
    pathDistance: 4.56,
    maxDisplacement: 3.21,
    poolCount: 7,
    hitTestFound: true,
    phase: 'mapping',
    mappingLeft: 8.76,
    scans: 3,
    misses: 2,
    lastReturnError: { posErr: 0.123, angleErr: 4.56 },
  });

  assert.equal(
    output,
    'viewer (m)  x 1.23  y 2.35  z -3.46\n'
      + '이동경로 4.6m   최대변위 3.2m\n'
      + '표면후보 7   hit-test FOUND\n'
      + 'depth usage unavailable\n'
      + 'depth format -\n'
      + 'phase mapping (8.8s)\n'
      + 'scan 3회 / miss 2회\n'
      + '복귀오차 0.12m, 4.6°',
  );
});

test('formatMetrics flags depth occlusion only when it is active', () => {
  const base = {
    viewerPosition: [0, 0, 0],
    pathDistance: 0,
    maxDisplacement: 0,
    poolCount: 7,
    hitTestFound: true,
    phase: 'hunt',
    mappingLeft: 0,
    scans: 0,
    misses: 0,
    lastReturnError: null,
  };

  assert.match(formatMetrics({ ...base, occlusionOn: true }), /표면후보 7   hit-test FOUND   가림 ON/);
  assert.doesNotMatch(formatMetrics({ ...base, occlusionOn: false }), /가림/);
  assert.doesNotMatch(formatMetrics(base), /가림/);
});

test('formatMetrics shows the point-cloud count only in cloud mode', () => {
  const base = {
    viewerPosition: [0, 0, 0],
    pathDistance: 0,
    maxDisplacement: 0,
    poolCount: 7,
    hitTestFound: true,
    phase: 'mapping',
    mappingLeft: 0,
    scans: 0,
    misses: 0,
    lastReturnError: null,
  };

  assert.match(formatMetrics({ ...base, pointCount: 1234 }), /hit-test FOUND   점 1234/);
  assert.doesNotMatch(formatMetrics(base), /점 /);
});

test('formatMetrics shows the depth usage and format selected by the XR session', () => {
  const output = formatMetrics({
    viewerPosition: [0, 0, 0],
    pathDistance: 0,
    maxDisplacement: 0,
    poolCount: 0,
    hitTestFound: false,
    phase: 'idle',
    mappingLeft: 0,
    scans: 0,
    misses: 0,
    lastReturnError: null,
    depthUsage: 'gpu-optimized',
    depthDataFormat: 'luminance-alpha',
  });

  assert.match(output, /depth usage gpu-optimized\n/);
  assert.match(output, /depth format luminance-alpha/);
});

test('formatMetrics reports unavailable when the XR session has no depth configuration', () => {
  const output = formatMetrics({
    viewerPosition: [0, 0, 0],
    pathDistance: 0,
    maxDisplacement: 0,
    poolCount: 0,
    hitTestFound: false,
    phase: 'idle',
    mappingLeft: 0,
    scans: 0,
    misses: 0,
    lastReturnError: null,
  });

  assert.match(output, /depth usage unavailable\n/);
  assert.match(output, /depth format -/);
});
