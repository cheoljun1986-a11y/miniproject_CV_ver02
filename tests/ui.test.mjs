import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatAnchorStatus,
  formatMetrics,
  formatOperatorStatus,
} from '../src/ui.js';

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
      + '고정 -\n'
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

test('formatMetrics identifies CPU occlusion and reports its live triangle count', () => {
  const output = formatMetrics({
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
    occlusionMode: 'cpu',
    occlusionTriangles: 321,
    voxelCount: 456,
    anchorState: 'anchor',
  });

  assert.match(output, /가림 CPU · 삼각형 321 · 복셀 456/);
  assert.match(output, /고정 anchor/);
});

test('formatMetrics reports solid voxels in cloud diagnostics without CPU triangles', () => {
  const output = formatMetrics({
    viewerPosition: [0, 0, 0],
    pathDistance: 0,
    maxDisplacement: 0,
    poolCount: 0,
    hitTestFound: false,
    phase: 'mapping',
    mappingLeft: 1,
    scans: 0,
    misses: 0,
    lastReturnError: null,
    voxelCount: 77,
  });

  assert.match(output, /hit-test searching   복셀 77/);
  assert.doesNotMatch(output, /삼각형/);
});

test('formatAnchorStatus distinguishes pending, lost, local, and empty states', () => {
  assert.equal(formatAnchorStatus('anchor-pending'), '고정 anchor 준비');
  assert.equal(formatAnchorStatus('anchor'), '고정 anchor');
  assert.equal(formatAnchorStatus('anchor-lost'), '고정 anchor (추적 일시 손실)');
  assert.equal(formatAnchorStatus('local'), '고정 local');
  assert.equal(formatAnchorStatus(null), '고정 -');
});

test('formatOperatorStatus reports map, anchor, ninja, and player state', () => {
  const output = formatOperatorStatus({
    anchorState: 'anchor-lost',
    voxelCount: 123,
    ninjaPosition: [1, 2, -3],
    playerPosition: [0.1, 1.6, -0.2],
    pathPointCount: 9,
  });

  assert.equal(
    output,
    '운영자 공간지도 · 복셀 123 · 미확정 0\n'
      + 'depth unavailable · 카메라 ?\n'
      + '고정 anchor (추적 일시 손실)\n'
      + 'Ninja  x 1.00  y 2.00  z -3.00\n'
      + '플레이어  x 0.10  y 1.60  z -0.20 · 경로 9점',
  );
});

test('formatOperatorStatus surfaces pending voxels so a stalled map is visible', () => {
  const output = formatOperatorStatus({ voxelCount: 12, pendingCount: 40000 });

  assert.match(output, /복셀 12/);
  assert.match(output, /미확정 40000/);
});

test('formatOperatorStatus reports the depth usage that produced the map', () => {
  const output = formatOperatorStatus({ depthUsage: 'cpu-optimized' });

  assert.match(output, /depth cpu-optimized/);
});

test('formatOperatorStatus flags depth that never arrived', () => {
  const output = formatOperatorStatus({ depthUsage: null });

  assert.match(output, /depth unavailable/);
});

test('formatOperatorStatus shows the occlusion triangle count when occlusion runs', () => {
  const output = formatOperatorStatus({ occlusionTriangles: 8123 });

  assert.match(output, /삼각형 8123/);
});

test('formatOperatorStatus omits the triangle count outside occlusion mode', () => {
  const output = formatOperatorStatus({ occlusionTriangles: null });

  assert.doesNotMatch(output, /삼각형/);
});

test('formatOperatorStatus reports camera access once a frame confirms it', () => {
  assert.match(formatOperatorStatus({ cameraAccess: true }), /카메라 O/);
});

test('formatOperatorStatus reports camera access the browser refused', () => {
  assert.match(formatOperatorStatus({ cameraAccess: false }), /카메라 X/);
});

test('formatOperatorStatus marks camera access unknown before the first frame', () => {
  assert.match(formatOperatorStatus({ cameraAccess: null }), /카메라 \?/);
});
