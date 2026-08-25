export const APP_MODES = Object.freeze({
  GPU_OCCLUSION: 'gpu-occlusion',
  CLOUD: 'cloud',
  CPU_OCCLUSION: 'cpu-occlusion',
  VOXEL_DEBUG: 'voxel-debug',
});

export function resolveAppMode(search = '') {
  const params = new URLSearchParams(search);
  // Checked first on purpose: a live occluder writes real-world depth, which
  // would depth-cull the voxel wireframe overlay behind every real object.
  if (params.get('voxel') === 'debug') return APP_MODES.VOXEL_DEBUG;
  if (params.get('occlusion') === 'cpu') return APP_MODES.CPU_OCCLUSION;
  if (params.get('depth') === 'cloud') return APP_MODES.CLOUD;
  return APP_MODES.GPU_OCCLUSION;
}

export function depthUsageForMode(mode) {
  return mode === APP_MODES.GPU_OCCLUSION ? 'gpu-optimized' : 'cpu-optimized';
}

export function usesSpaceMapping(mode) {
  return mode === APP_MODES.CPU_OCCLUSION
    || mode === APP_MODES.CLOUD
    || mode === APP_MODES.VOXEL_DEBUG;
}

// The hide-and-seek game is pure noise in a diagnostic session: startSession()
// spawns 27 hit-test surface markers over the camera feed, hides the hatchling,
// and drives the phase to 'hunt'. phase === 'idle' is already the quiet state,
// so gating the one lifecycle call is the whole fix. The debug panel offers a
// manual "게임 시작" button for when the occluder needs something to hide.
export function autoStartsGame(mode) {
  return mode !== APP_MODES.VOXEL_DEBUG;
}

// DepthCloud/VoxelMap accumulate every 200ms with no per-frame dedup, so a
// single frame can promote a voxel on its own. The voxel-debug pipeline
// replaces them rather than extending them; the legacy modes keep them as-is.
export function usesDepthCloud(mode) {
  return mode === APP_MODES.CPU_OCCLUSION || mode === APP_MODES.CLOUD;
}
