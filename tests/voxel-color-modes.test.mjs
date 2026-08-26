import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOXEL_COLOR_MODES,
  nextColorMode,
  voxelColorRGB,
} from '../src/voxel-color-modes.js';

const cell = (observationCount, clusterId = null) => ({ observationCount, clusterId });

test('observation mode uses the spec red/yellow/green buckets', () => {
  const one = voxelColorRGB(cell(1), VOXEL_COLOR_MODES.OBSERVATION);
  const two = voxelColorRGB(cell(2), VOXEL_COLOR_MODES.OBSERVATION);
  const three = voxelColorRGB(cell(3), VOXEL_COLOR_MODES.OBSERVATION);
  const four = voxelColorRGB(cell(9), VOXEL_COLOR_MODES.OBSERVATION);

  assert.ok(one[0] > one[1] && one[0] > one[2], 'one observation reads red');
  assert.ok(two[0] > 0.9 && two[1] > 0.7 && two[2] < 0.4, 'two reads yellow');
  assert.ok(three[1] > three[0] && three[1] > three[2], 'three reads green');
  assert.deepEqual(four, three, 'four or more shares the three-plus bucket');
});

// Pinned so ?depth=cloud keeps the exact look it has today.
test('height mode reproduces operator-view.js line 88 exactly', () => {
  const at = (y) => voxelColorRGB(cell(1), VOXEL_COLOR_MODES.HEIGHT, { y });
  const legacy = (y) => {
    const t = Math.min(1, Math.max(0, (y + 1) / 3));
    return [0.2 + 0.8 * t, 0.5, 1 - 0.8 * t];
  };
  for (const y of [-2, -1, 0, 0.75, 2, 5]) {
    assert.deepEqual(at(y), legacy(y));
  }
  const close = (rgb, want) => rgb.forEach((c, i) => assert.ok(Math.abs(c - want[i]) < 1e-9));
  close(at(-1), [0.2, 0.5, 1]);
  close(at(2), [1, 0.5, 0.2]);
});

test('cluster mode is grey until Phase 4 fills clusterId', () => {
  const unassigned = voxelColorRGB(cell(3), VOXEL_COLOR_MODES.CLUSTER);
  assert.deepEqual(unassigned, [0.6, 0.6, 0.6]);
});

test('cluster colours are stable and not grey once assigned', () => {
  const a = voxelColorRGB(cell(3, 7), VOXEL_COLOR_MODES.CLUSTER);
  const b = voxelColorRGB(cell(1, 7), VOXEL_COLOR_MODES.CLUSTER);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, [0.6, 0.6, 0.6]);
  assert.notDeepEqual(a, voxelColorRGB(cell(3, 8), VOXEL_COLOR_MODES.CLUSTER));
});

test('every channel stays inside 0..1', () => {
  for (const mode of Object.values(VOXEL_COLOR_MODES)) {
    for (const y of [-99, 0, 99]) {
      for (const rgb of [voxelColorRGB(cell(1, 3), mode, { y })]) {
        for (const channel of rgb) {
          assert.ok(channel >= 0 && channel <= 1, `${mode} ${channel}`);
        }
      }
    }
  }
});

test('the mode cycles back around', () => {
  assert.equal(nextColorMode(VOXEL_COLOR_MODES.OBSERVATION), VOXEL_COLOR_MODES.HEIGHT);
  assert.equal(nextColorMode(VOXEL_COLOR_MODES.HEIGHT), VOXEL_COLOR_MODES.CLUSTER);
  assert.equal(nextColorMode(VOXEL_COLOR_MODES.CLUSTER), VOXEL_COLOR_MODES.OBSERVATION);
  assert.equal(nextColorMode('nonsense'), VOXEL_COLOR_MODES.OBSERVATION);
});
