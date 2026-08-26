import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_MODES,
  autoStartsGame,
  depthUsageForMode,
  depthUsageForSession,
  resolveAppMode,
  usesDepthCloud,
  usesSpaceMapping,
  usesVoxelOccluder,
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

test('voxel debug URL selects the keyframe voxel diagnostic', () => {
  assert.equal(resolveAppMode('?voxel=debug'), 'voxel-debug');
  assert.equal(resolveAppMode('?voxel=on'), 'gpu-occlusion');
});

// A live CPU occluder writes real-world depth, which would depth-cull the voxel
// wireframe overlay exactly where we most need to see it (behind a table).
test('voxel debug outranks the other experimental parameters', () => {
  assert.equal(resolveAppMode('?voxel=debug&occlusion=cpu'), 'voxel-debug');
  assert.equal(resolveAppMode('?depth=cloud&voxel=debug'), 'voxel-debug');
});

test('voxel debug requests CPU-optimized depth and shares the space-map wiring', () => {
  assert.equal(depthUsageForMode(APP_MODES.VOXEL_DEBUG), 'cpu-optimized');
  assert.equal(usesSpaceMapping(APP_MODES.VOXEL_DEBUG), true);
});

test('only the legacy modes drive DepthCloud and VoxelMap', () => {
  assert.equal(usesDepthCloud(APP_MODES.CPU_OCCLUSION), true);
  assert.equal(usesDepthCloud(APP_MODES.CLOUD), true);
  assert.equal(usesDepthCloud(APP_MODES.VOXEL_DEBUG), false);
  assert.equal(usesDepthCloud(APP_MODES.GPU_OCCLUSION), false);
});

test('only the voxel diagnostic keeps the game idle at session start', () => {
  assert.equal(autoStartsGame(APP_MODES.GPU_OCCLUSION), true);
  assert.equal(autoStartsGame(APP_MODES.CPU_OCCLUSION), true);
  assert.equal(autoStartsGame(APP_MODES.CLOUD), true);
  assert.equal(autoStartsGame(APP_MODES.VOXEL_DEBUG), false);
});

test('the voxel occluder is an axis of its own, not a mode', () => {
  assert.equal(usesVoxelOccluder('?occluder=voxel'), true);
  assert.equal(usesVoxelOccluder(''), false);
  assert.equal(usesVoxelOccluder('?occluder=cpu'), false);
  // Composes with every depth pipeline instead of competing with them.
  assert.equal(resolveAppMode('?occluder=voxel'), 'gpu-occlusion');
  assert.equal(resolveAppMode('?occlusion=cpu&occluder=voxel'), 'cpu-occlusion');
});

// One session, one depth usage: the occluder needs CPU-readable depth, so
// asking for it overrides the GPU preference the default mode would pick.
test('the voxel occluder forces CPU-readable depth', () => {
  assert.equal(depthUsageForSession(APP_MODES.GPU_OCCLUSION, false), 'gpu-optimized');
  assert.equal(depthUsageForSession(APP_MODES.GPU_OCCLUSION, true), 'cpu-optimized');
  assert.equal(depthUsageForSession(APP_MODES.CPU_OCCLUSION, true), 'cpu-optimized');
  assert.equal(depthUsageForSession(APP_MODES.VOXEL_DEBUG, false), 'cpu-optimized');
});

const {
  TERRAIN_SOURCES, FUSION_MODES, resolveTerrainSource, resolveFusionMode,
  usesKeyframeTerrain, usesLegacyTerrain,
} = await import('../src/app-mode.js');

test('the keyframe accumulator is the default game terrain; legacy is opt-out', () => {
  assert.equal(resolveTerrainSource(''), TERRAIN_SOURCES.KEYFRAME);
  assert.equal(resolveTerrainSource('?occlusion=cpu'), TERRAIN_SOURCES.KEYFRAME);
  assert.equal(resolveTerrainSource('?terrain=keyframe'), TERRAIN_SOURCES.KEYFRAME);
  assert.equal(resolveTerrainSource('?terrain=legacy'), TERRAIN_SOURCES.LEGACY);
});

test('TSDF is the default fusion; hit counting is opt-out', () => {
  assert.equal(resolveFusionMode(''), FUSION_MODES.TSDF);
  assert.equal(resolveFusionMode('?fusion=tsdf'), FUSION_MODES.TSDF);
  assert.equal(resolveFusionMode('?fusion=count'), FUSION_MODES.COUNT);
});

test('exactly one terrain accumulator runs, and only in the game map modes', () => {
  for (const mode of [APP_MODES.CPU_OCCLUSION, APP_MODES.CLOUD]) {
    assert.equal(usesKeyframeTerrain(mode, '?occlusion=cpu'), true);
    assert.equal(usesLegacyTerrain(mode, '?occlusion=cpu'), false);
    assert.equal(usesLegacyTerrain(mode, '?occlusion=cpu&terrain=legacy'), true);
    assert.equal(usesKeyframeTerrain(mode, '?occlusion=cpu&terrain=legacy'), false);
  }
  for (const mode of [APP_MODES.GPU_OCCLUSION, APP_MODES.VOXEL_DEBUG]) {
    assert.equal(usesKeyframeTerrain(mode, ''), false);
    assert.equal(usesLegacyTerrain(mode, '?terrain=legacy'), false);
  }
});
