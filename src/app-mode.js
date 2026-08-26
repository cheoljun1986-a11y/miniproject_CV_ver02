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

// Occlusion source is a different axis from the depth pipeline, so it is a
// separate parameter rather than another APP_MODES value. Folding them into
// one priority chain would produce gpu+voxel, cpu+voxel and so on — a
// combinatorial mess in a file this small.
export function usesVoxelOccluder(search = '') {
  return new URLSearchParams(search).get('occluder') === 'voxel';
}

// A WebXR session negotiates one depth usage, so the voxel occluder and
// three's GPU depth-sensing mesh cannot coexist: building the occluder needs
// CPU-readable depth for keyframe capture. Pair it with ?occlusion=cpu instead
// — that runtime mesh comes off the same cpu-optimized feed and covers what
// the scan missed, while the occluder covers what is currently out of view.
export function depthUsageForSession(mode, voxelOccluder = false) {
  if (voxelOccluder) return 'cpu-optimized';
  return depthUsageForMode(mode);
}

// The hide-and-seek game is pure noise in a diagnostic session: startSession()
// spawns 27 hit-test surface markers over the camera feed, hides the hatchling,
// and drives the phase to 'hunt'. phase === 'idle' is already the quiet state,
// so gating the one lifecycle call is the whole fix. The debug panel offers a
// manual "게임 시작" button for when the occluder needs something to hide.
export function autoStartsGame(mode) {
  return mode !== APP_MODES.VOXEL_DEBUG;
}

// The game modes that accumulate a space map. Which accumulator runs is a
// separate axis — see resolveTerrainSource.
export function usesDepthCloud(mode) {
  return mode === APP_MODES.CPU_OCCLUSION || mode === APP_MODES.CLOUD;
}

// Which accumulator feeds the game's space map (operator view + chase terrain).
//   legacy   — DepthCloud + VoxelMap on a 200ms timer with no per-frame dedup,
//              so a single frame can promote a voxel on its own. Default until
//              the keyframe path is proven on device.
//   keyframe — pose-gated capture with per-frame dedup (VoxelTerrain).
//              Opt in with ?terrain=keyframe.
export const TERRAIN_SOURCES = Object.freeze({
  KEYFRAME: 'keyframe',
  LEGACY: 'legacy',
});

export function resolveTerrainSource(search = '') {
  return new URLSearchParams(search).get('terrain') === 'keyframe'
    ? TERRAIN_SOURCES.KEYFRAME
    : TERRAIN_SOURCES.LEGACY;
}

export function usesKeyframeTerrain(mode, search = '') {
  return usesDepthCloud(mode) && resolveTerrainSource(search) === TERRAIN_SOURCES.KEYFRAME;
}

export function usesLegacyTerrain(mode, search = '') {
  return usesDepthCloud(mode) && resolveTerrainSource(search) === TERRAIN_SOURCES.LEGACY;
}
